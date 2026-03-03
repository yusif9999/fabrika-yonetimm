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
app.post('/api/saas/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const admin = await AdminModel.findOne({ username, password: hashPassword(password) });
    
    // admin.email bilgisini de frontend'e gönderiyoruz
    if (admin) res.json({ success: true, username: admin.username, email: admin.email || '' });
    else res.status(401).json({ error: "Hatalı yönetici bilgisi." });
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
// 7. Admin: Silme / Güncelleme

// YENİ: Şirket silme güvenlik kodlarını tutacağımız geçici hafıza

// 7. Admin: Silme / Güncelleme

// YENİ: Şirket silme güvenlik kodlarını tutacağımız geçici hafıza
const deleteCompanyCodes = new Map(); 

// YENİ: Şirket Silme Onay Kodu Gönderme API'si
app.post('/api/saas/admin/request-delete-company', async (req, res) => {
    try {
        const { companyId } = req.body;
        
        // Yöneticiyi bul ve e-postasını kontrol et
        const admin = await AdminModel.findOne();
        if (!admin || !admin.email) {
            return res.status(400).json({ error: "Sistem yöneticisine ait e-posta bulunamadı. Lütfen ayarlardan e-posta adresinizi kaydedin." });
        }

        // 6 haneli rastgele kod üret
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Kodu 5 dakika (300.000 ms) geçerli olacak şekilde kaydet
        deleteCompanyCodes.set(companyId, { code, expires: Date.now() + 300000 });

        const mailOptions = {
            from: 'fabrikayonetimpaneli@gmail.com',
            to: admin.email,
            subject: '🚨 GÜVENLİK UYARISI: Şirket Silme Onay Kodu',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #d9534f;">Şirket Silme Talebi</h2>
                    <p>Sisteminizden bir şirketi kalıcı olarak silmek için talepte bulunuldu.</p>
                    <p>Güvenlik Kodunuz:</p>
                    <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 5px; font-size: 24px; letter-spacing: 5px;">
                        <b>${code}</b>
                    </div>
                    <p style="color: #666; font-size: 12px; margin-top: 15px;">Bu kod 5 dakika boyunca geçerlidir.</p>
                </div>
            `
        };

        // E-postayı gönder
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("\n❌ ŞİRKET SİLME MAİLİ GÖNDERME HATASI ❌");
                console.log(error);
                return res.status(500).json({ error: "E-posta gönderilemedi. Lütfen sunucu loglarını kontrol edin." });
            }
            res.json({ success: true, message: "Kod gönderildi." });
        });

    } catch (error) {
        console.error("Kod gönderme hatası:", error);
        res.status(500).json({ error: "Sunucuda beklenmeyen bir hata oluştu." });
    }
});

// GÜNCELLENMİŞ: Şirketi Silme (Kod Doğrulamalı)
app.post('/api/saas/admin/delete', async (req, res) => {
    try {
        const { id, code } = req.body;
        
        // 1. Güvenlik Kodunu Kontrol Et
        const verification = deleteCompanyCodes.get(id);
        
        if (!verification) return res.status(400).json({ error: "Geçerli bir onay kodu bulunamadı." });
        if (Date.now() > verification.expires) {
            deleteCompanyCodes.delete(id);
            return res.status(400).json({ error: "Onay kodunun 5 dakikalık süresi dolmuş." });
        }
        if (verification.code !== code) return res.status(400).json({ error: "Hatalı onay kodu girdiniz." });

        // 2. Şirket Durumunu Kontrol Et
        const company = await CompanyModel.findById(id);
        if (!company) return res.status(404).json({ error: "Şirket bulunamadı." });
        if (company.status !== 'Suspended' && company.status !== 'Pending') {
            return res.status(400).json({ error: "Sadece askıdaki veya onay bekleyen şirketler silinebilir." });
        }

        // 3. Şirketi Sil ve Kodu Hafızadan Temizle
        await CompanyModel.findByIdAndDelete(id);
        deleteCompanyCodes.delete(id);
        
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
        
        if (!admin) return res.status(404).json({ error: "Bu kullanıcı adında bir yönetici bulunamadı." });
        if (!admin.email) return res.status(400).json({ error: "Bu yönetici hesabına tanımlı bir kurtarma e-postası yok. Lütfen veritabanı yöneticinizle görüşün." });

        // 6 haneli rastgele kod oluştur
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Kodu ve 15 dakikalık geçerlilik süresini kaydet
        admin.resetCode = resetCode;
        admin.resetCodeExpire = Date.now() + 15 * 60 * 1000; 
        await admin.save();

        // E-postayı gönder
        const mailOptions = {
            from: 'sizin_eposta_adresiniz@gmail.com',
            to: admin.email,
            subject: 'Sistem Yöneticisi - Şifre Sıfırlama Kodu',
            text: `Yönetici paneliniz için şifre sıfırlama kodu talep ettiniz.\n\nSıfırlama Kodunuz: ${resetCode}\n\nBu kod 15 dakika boyunca geçerlidir.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                // --- HATAYI TERMİNALE YAZDIRMA KODU EKLENDİ ---
                console.log("\n❌ MAİL GÖNDERME HATASI DETAYI ❌");
                console.log(error);
                console.log("====================================\n");
                // ----------------------------------------------
                return res.status(500).json({ error: "E-posta gönderilmedi. Sunucu ayarlarını kontrol edin." });
            }
            res.json({ success: true, message: "Sıfırlama kodu e-posta adresinize başarıyla gönderildi." });
        });
    } catch (error) { res.status(500).json({ error: "Bir hata oluştu." }); }
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

// YENİ: Şirket Silme Onay Kodu Gönderme
app.post('/api/saas/admin/request-delete-company', async (req, res) => {
    try {
        const { companyId } = req.body;
        
        // Yöneticiyi bul ve e-postasını al
        const admin = await AdminModel.findOne();
        if (!admin || !admin.email) {
            return res.status(400).json({ error: "Yönetici e-posta adresi bulunamadı. Lütfen ayarlardan e-posta ekleyin." });
        }

        // 6 haneli rastgele güvenlik kodu üret
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Kodu 5 dakika (300.000 ms) geçerli olacak şekilde hafızaya kaydet
        deleteCompanyCodes.set(companyId, { code, expires: Date.now() + 300000 });

        // Onay mailini gönder (Nodemailer transporter'ınızın tanımlı olduğunu varsayıyoruz)
        const mailOptions = {
            from: process.env.EMAIL_USER || 'sistem@sirketiniz.com', // Sistem mailiniz
            to: admin.email,
            subject: '🚨 GÜVENLİK UYARISI: Şirket Silme Onay Kodu',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #d9534f;">Şirket Silme Talebi</h2>
                    <p>Sisteminizden bir şirketi kalıcı olarak silmek için talepte bulunuldu.</p>
                    <p>Eğer bu işlemi siz yapıyorsanız, aşağıdaki güvenlik kodunu sisteme girerek işlemi tamamlayabilirsiniz:</p>
                    <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 5px;">
                        <h1 style="color: #333; letter-spacing: 5px; margin: 0;">${code}</h1>
                    </div>
                    <p style="color: #666; font-size: 12px; margin-top: 15px;">Bu kod 5 dakika boyunca geçerlidir.</p>
                    <p style="color: red; font-weight: bold;">Eğer bu işlemi siz başlatmadıysanız, sisteminize acilen müdahale edin ve şifrenizi değiştirin!</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: "Güvenlik kodu e-posta adresinize gönderildi." });

    } catch (error) {
        console.error("Kod gönderme hatası:", error);
        res.status(500).json({ error: "E-posta gönderilirken bir hata oluştu." });
    }
});

// --- GEÇİCİ ŞİFRE SIFIRLAMA KODU (İşlem bitince bu kısmı silin) ---

// --- GEÇİCİ ŞİFRE SIFIRLAMA KODU (İşlem bitince bu kısmı silin) ---


app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});