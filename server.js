/**
 * FABRIKA YÖNETİM PANELİ - SAAS VERSİYONU (TAM PROJE)
 * Abonelik, Ödeme, Kayıt, Yönetici ve Çoklu Şirket Sistemi
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
// Yönetici giriş kodlarını tutacağımız geçici hafıza


const app = express();
const PORT = process.env.PORT || 3000;

// --- MONGODB BAĞLANTISI ---
// Senin verdiğin veritabanı adresi:
const MONGO_URI = "mongodb+srv://admin:azerbaycan19181991@cluster0.g9jgkag.mongodb.net/fabrika?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Veritabanına Başarıyla Bağlandı!");
        await initAdmin(); // Yönetici kontrolü
    })
    .catch(err => console.error("❌ Bağlantı Hatası:", err));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// --- MODELLER ---

// 1. Sistem Yöneticisi (Super Admin)
const AdminSchema = new mongoose.Schema({ 
    username: String, 
    password: String,
    email: { type: String, default: '' }, // Şifre sıfırlama için e-posta
    resetCode: String,                    // Gönderilen 6 haneli kod
    resetCodeExpire: Date                 // Kodun son kullanma tarihi
});
const AdminModel = mongoose.model('SystemAdmin', AdminSchema);

// E-POSTA GÖNDERİCİ AYARLARI (Nodemailer)
// Kendi Gmail adresinizi ve "Uygulama Şifrenizi" buraya girin.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'fabrikayonetimpaneli@gmail.com', // Kendi e-postanız (veya process.env.EMAIL_USER)
        pass: 'uunditkfkysnvske' // 16 haneli şifreniz (veya process.env.EMAIL_PASS)
    },
    // EKLENEN KISIM BURASI: Antivirüs/Ağ engellerini aşmak için
    tls: {
        rejectUnauthorized: false
    }
});

// 2. Şirket Modeli
const CompanySchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    email: { type: String, required: true, unique: true }, // E-Posta benzersiz
    username: { type: String, required: true },
    password: { type: String, required: true },
    status: { type: String, default: 'Pending' }, // Pending, Active, Suspended
    subscriptionStartDate: { type: Date, default: null }, 
    subscriptionEndDate: { type: Date, default: null },
    registeredAt: { type: Date, default: Date.now },
    appData: { type: Object, default: {} } // Fabrika verileri
});
const CompanyModel = mongoose.model('Company', CompanySchema);

// 3. Ödemeler Modeli (Raporlama)
const PaymentSchema = new mongoose.Schema({
    companyId: mongoose.Schema.Types.ObjectId,
    companyName: String,
    amount: Number,
    period: String,
    paymentDate: { type: Date, default: Date.now }
});
const PaymentModel = mongoose.model('Payment', PaymentSchema);


// --- YARDIMCI FONKSİYONLAR ---
const hashPassword = (pass) => crypto.createHash('sha256').update(pass).digest('hex');

async function initAdmin() {
    // Yönetici yoksa oluştur: master / master123
    const count = await AdminModel.countDocuments();
    if (count === 0) {
        await new AdminModel({ username: "master", password: hashPassword("master123") }).save();
        console.log("⚙️ Varsayılan Yönetici Oluşturuldu: master / master123");
    }
}

// --- API ENDPOINTLERİ ---

// 1. Şirket Kaydı
app.post('/api/saas/register', async (req, res) => {
    try {
        const { companyName, email, username, password } = req.body;
        const existing = await CompanyModel.findOne({ email });
        if (existing) return res.status(400).json({ error: "Bu E-Posta adresi zaten kayıtlı." });

        const newCompany = new CompanyModel({
            companyName, email, username,
            password: hashPassword(password),
            status: 'Pending',
            appData: { fabrikalar: [], uretimler: [], giderler: [], odemeler: [], vardiyalar: [], personel: [], pozisyonlar: [] }
        });
        await newCompany.save();
        res.json({ success: true, message: "Kayıt başarılı! Yönetici onayı bekleniyor." });
    } catch (error) { res.status(500).json({ error: "Kayıt hatası." }); }
});

// 2. Şirket Girişi
app.post('/api/saas/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const company = await CompanyModel.findOne({ 
            $or: [{ username }, { email: username }],
            password: hashPassword(password) 
        });

        if (!company) return res.status(401).json({ error: "Hatalı bilgi." });
        if (company.status === 'Pending') return res.status(403).json({ error: "Hesabınız onay bekliyor." });
        if (company.status === 'Suspended') return res.status(403).json({ error: "Hesabınız askıya alınmıştır." });

        if (company.subscriptionEndDate && new Date() > new Date(company.subscriptionEndDate)) {
            return res.status(403).json({ error: "Abonelik süreniz dolmuştur." });
        }

        res.json({ success: true, companyId: company._id, companyName: company.companyName });
    } catch (error) { res.status(500).json({ error: "Giriş hatası." }); }
});

// 3. Admin Girişi
// 3. Admin Girişi (1. Aşama: Şifre Kontrolü ve E-Posta Gönderimi)
const adminLoginCodes = new Map();

// 2. Admin Girişi (SADECE GİRİŞTE KOD GÖNDERİR)
app.post('/api/saas/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const admin = await AdminModel.findOne({ username, password: hashPassword(password) });
    
    if (!admin) return res.status(401).json({ error: "Hatalı yönetici bilgisi." });

    // Yöneticinin e-postası kayıtlıysa güvenli giriş için 2FA kodunu gönder
    if (admin.email) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        // Kodu 5 dakika geçerli olacak şekilde kaydet
        adminLoginCodes.set(username, { code, expires: Date.now() + 5 * 60 * 1000 });

        const mailOptions = {
            from: 'fabrikayonetimpaneli@gmail.com',
            to: admin.email,
            subject: '🔒 Sistem Yöneticisi Giriş Kodu',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #2c3e50;">Yönetici Paneli Giriş İsteği</h2>
                    <p>Yönetici paneline giriş yapmak için şifreniz doğru girildi. Lütfen aşağıdaki doğrulama kodunu kullanarak girişinizi tamamlayın:</p>
                    <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 5px; font-size: 24px; letter-spacing: 5px;">
                        <b>${code}</b>
                    </div>
                    <p style="color: #666; font-size: 12px; margin-top: 15px;">Bu kod 5 dakika boyunca geçerlidir.</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (error) => {
            if(error) console.log("Giriş Mail Hatası:", error);
        });

        return res.json({ requires2FA: true, message: "E-posta adresinize 6 haneli giriş kodu gönderildi." });
    } else {
        // Sistemde e-posta kayıtlı değilse (ilk kurulum anı), sistemi kilitlememek için uyarı ile içeri al
        return res.json({ success: true, username: admin.username, email: '', warning: 'no_email' });
    }
});
// YENİ: Admin Girişi (2. Aşama: Kod Doğrulama)
app.post('/api/saas/admin/verify-login', async (req, res) => {
    const { username, password, code } = req.body;
    
    const verification = adminLoginCodes.get(username);
    if (!verification) return res.status(400).json({ error: "Geçerli bir giriş kodu bulunamadı." });
    if (Date.now() > verification.expires) {
        adminLoginCodes.delete(username);
        return res.status(400).json({ error: "Kodun 5 dakikalık süresi dolmuş." });
    }
    if (verification.code !== code) return res.status(400).json({ error: "Hatalı kod girdiniz." });

    const admin = await AdminModel.findOne({ username, password: hashPassword(password) });
    if (!admin) return res.status(401).json({ error: "Oturum doğrulanamadı." });

    adminLoginCodes.delete(username); // Başarılı giriş sonrası hafızadan sil
    res.json({ success: true, username: admin.username, email: admin.email || '' });
});

// 4. Admin: Şirket Listesi
app.get('/api/saas/admin/companies', async (req, res) => {
    try {
        const companies = await CompanyModel.find({}, '-appData').sort({ registeredAt: -1 });
        res.json(companies);
    } catch (error) { res.status(500).json({ error: "Veri çekilemedi." }); }
});

// 5. Admin: ABONELİK VE ÖDEME EKLEME (Hatayı çözen kısım burası)
app.post('/api/saas/admin/add-subscription', async (req, res) => {
    try {
        const { companyId, amount, months, startDate } = req.body;
        const company = await CompanyModel.findById(companyId);
        if (!company) return res.status(404).json({ error: "Şirket bulunamadı" });

        const start = startDate ? new Date(startDate) : new Date();
        const end = new Date(start);
        end.setMonth(end.getMonth() + parseInt(months));

        company.status = 'Active';
        company.subscriptionStartDate = start;
        company.subscriptionEndDate = end;
        await company.save();

        const payment = new PaymentModel({
            companyId: company._id,
            companyName: company.companyName,
            amount: amount,
            period: months + ' Ay',
            paymentDate: new Date()
        });
        await payment.save();

        res.json({ success: true, message: "Abonelik başarıyla tanımlandı." });
    } catch (error) { res.status(500).json({ error: "İşlem hatası." }); }
});

// 6. Admin: Ödeme Geçmişi
app.get('/api/saas/admin/payments', async (req, res) => {
    const payments = await PaymentModel.find().sort({ paymentDate: -1 });
    res.json(payments);
});

// YENİ: Admin: Ödemeyi Sil
app.delete('/api/saas/admin/payments/:id', async (req, res) => {
    try {
        await PaymentModel.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Ödeme başarıyla silindi." });
    } catch (error) { 
        res.status(500).json({ error: "Ödeme silinirken hata oluştu." }); 
    }
});

// YENİ: Admin: Ödemeyi Güncelle
app.put('/api/saas/admin/payments/:id', async (req, res) => {
    try {
        const { amount, period } = req.body;
        await PaymentModel.findByIdAndUpdate(req.params.id, { amount, period });
        res.json({ success: true, message: "Ödeme başarıyla güncellendi." });
    } catch (error) { 
        res.status(500).json({ error: "Ödeme güncellenirken hata oluştu." }); 
    }
});

// 7. Admin: Silme / Güncelleme



// GÜNCELLENMİŞ: Şirketi Silme (Kod Doğrulamalı)
// Şirketi Silme (E-posta kodu iptal edildi, direkt siler)
app.post('/api/saas/admin/delete', async (req, res) => {
    try {
        const { id } = req.body;
        
        // Şirket Durumunu Kontrol Et
        const company = await CompanyModel.findById(id);
        if (!company) return res.status(404).json({ error: "Şirket bulunamadı." });
        
        if (company.status !== 'Suspended' && company.status !== 'Pending') {
            return res.status(400).json({ error: "Sadece askıdaki veya onay bekleyen şirketler silinebilir." });
        }

        // Şirketi direkt sil
        await CompanyModel.findByIdAndDelete(id);
        
        res.json({ success: true });
    } catch (error) { 
        res.status(500).json({ error: "Silme hatası." }); 
    }
});

app.post('/api/saas/admin/update', async (req, res) => {
    try {
        await CompanyModel.findByIdAndUpdate(req.body.id, { status: req.body.status });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Hata" }); }
});

// Admin: Bilgileri Güncelleme (GÜNCELLENDİ: Daha güvenli e-posta kaydı)
app.post('/api/saas/admin/update-credentials', async (req, res) => {
    try {
        const { newUsername, newPassword, newEmail } = req.body;
        const admin = await AdminModel.findOne();
        
        if (newUsername) admin.username = newUsername;
        if (newPassword) admin.password = hashPassword(newPassword);
        if (newEmail !== undefined) admin.email = newEmail; // E-posta veritabanına işleniyor
        
        await admin.save();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Hata" }); }
});

// 8. Uygulama Verileri
app.get('/api/data', async (req, res) => {
    const companyId = req.headers['company-id'];
    if (!companyId) return res.status(400).json({ error: "Giriş yapılmamış" });
    const company = await CompanyModel.findById(companyId);
    res.json(company ? (company.appData || {}) : {});
});

app.post('/api/data', async (req, res) => {
    const companyId = req.headers['company-id'];
    if (!companyId) return res.status(400).json({ error: "Giriş yapılmamış" });
    await CompanyModel.findByIdAndUpdate(companyId, { appData: req.body });
    res.json({ success: true });
});

// Admin: Şifremi Unuttum - Kod Gönder
app.post('/api/saas/admin/forgot-password', async (req, res) => {
    try {
        const { username } = req.body;
        const admin = await AdminModel.findOne({ username });
        
        if (!admin) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        if (!admin.email) return res.status(400).json({ error: "Bu hesaba kayıtlı bir kurtarma e-postası yok." });

        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        admin.resetCode = resetCode;
        admin.resetCodeExpire = Date.now() + 15 * 60 * 1000; 
        await admin.save();

        const mailOptions = {
            from: 'fabrikayonetimpaneli@gmail.com',
            to: admin.email,
            subject: 'Sistem Yöneticisi - Şifre Sıfırlama Kodu',
            text: `Yönetici paneliniz için şifre sıfırlama kodu talep ettiniz.\n\nSıfırlama Kodunuz: ${resetCode}\n\nBu kod 15 dakika boyunca geçerlidir.`
        };

        transporter.sendMail(mailOptions);
        res.json({ success: true, message: "Sıfırlama kodu e-posta adresinize gönderildi." });
    } catch (error) { res.status(500).json({ error: "Hata oluştu." }); }
});

// Admin: Şifre Sıfırlama Kodu Doğrulama ve Şifre Değiştirme
app.post('/api/saas/admin/reset-password', async (req, res) => {
    try {
        const { username, code, newPassword } = req.body;
        
        // Kullanıcıyı, doğru kodu ve süresi dolmamış kodu kontrol et
        const admin = await AdminModel.findOne({ 
            username, 
            resetCode: code, 
            resetCodeExpire: { $gt: Date.now() } // Şu anki zamandan büyük mü?
        });

        if (!admin) return res.status(400).json({ error: "Geçersiz veya süresi dolmuş kod girdiniz." });

        // Şifreyi güncelle ve kodları temizle
        admin.password = hashPassword(newPassword);
        admin.resetCode = undefined;
        admin.resetCodeExpire = undefined;
        await admin.save();

        res.json({ success: true, message: "Şifreniz başarıyla değiştirildi. Şimdi giriş yapabilirsiniz." });
    } catch (error) { res.status(500).json({ error: "Bir hata oluştu." }); }
});

// Admin: Bilgileri Güncelleme (GÜNCELLENDİ: Artık Email'i de kaydediyor)
app.post('/api/saas/admin/update-credentials', async (req, res) => {
    try {
        const { newUsername, newPassword, newEmail } = req.body;
        const admin = await AdminModel.findOne();
        if (newUsername) admin.username = newUsername;
        if (newPassword) admin.password = hashPassword(newPassword);
        if (newEmail) admin.email = newEmail; // E-posta kaydetme özelliği eklendi
        await admin.save();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Hata" }); }
});



// --- GEÇİCİ ŞİFRE SIFIRLAMA KODU (İşlem bitince bu kısmı silin) ---

// --- GEÇİCİ ŞİFRE SIFIRLAMA KODU (İşlem bitince bu kısmı silin) ---


app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});