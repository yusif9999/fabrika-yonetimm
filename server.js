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
    appData: { type: Object, default: {} }, // Fabrika verileri
    resetCode: String,
    resetCodeExpire: Date
});
const CompanyModel = mongoose.model('Company', CompanySchema);

// E-Posta Doğrulama Kodları Modeli (Geçici)
const EmailVerificationSchema = new mongoose.Schema({
    email: String,
    code: String,
    createdAt: { type: Date, expires: '15m', default: Date.now } // 15 dakika sonra otomatik silinir
});
const EmailVerificationModel = mongoose.model('EmailVerification', EmailVerificationSchema);

// 3. Ödemeler Modeli (Raporlama)
const PaymentSchema = new mongoose.Schema({
    companyId: mongoose.Schema.Types.ObjectId,
    companyName: String,
    amount: Number,
    period: String,
    paymentDate: { type: Date, default: Date.now }
});
const PaymentModel = mongoose.model('Payment', PaymentSchema);

// 3.5. Ödeme Geçmişi (Log) Modeli
const PaymentLogSchema = new mongoose.Schema({
    action: String, // 'Silindi' veya 'Düzenlendi'
    companyName: String,
    oldAmount: Number,
    newAmount: Number,
    oldPeriod: String,
    newPeriod: String,
    logDate: { type: Date, default: Date.now }
});
const PaymentLogModel = mongoose.model('PaymentLog', PaymentLogSchema);

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

// 1. Şirket Kaydı (Adım 2: Kodu Doğrulama ve Kaydı Tamamlama)
// 1. Şirket Kaydı (Adım 1: Onay Kodu Gönderme)

// 1. Şirket Kaydı (Adım 1: Onay Kodu Gönderme)
app.post('/api/saas/request-register-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        // E-Posta daha önce kayıtlı mı kontrolü
        const existing = await CompanyModel.findOne({ email });
        if (existing) return res.status(400).json({ error: "Bu E-Posta adresi zaten kayıtlı." });

        // 6 haneli rastgele kod oluştur
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Kodu veritabanına kaydet (Varsa güncelle)
        await EmailVerificationModel.findOneAndUpdate(
            { email },
            { code, createdAt: Date.now() },
            { upsert: true }
        );

        // E-Postayı gönder
        const mailOptions = {
            from: 'fabrikayonetimpaneli@gmail.com', // Kendi gönderici adresiniz
            to: email,
            subject: 'Fabrika Yönetimi - Kayıt Onay Kodu',
            text: `İşletme kaydınızı tamamlamak için onay kodunuz: ${code}\n\nBu kod 15 dakika boyunca geçerlidir.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("Kayıt Mail Hatası:", error);
                return res.status(500).json({ error: "E-posta gönderilemedi. Girdiğiniz adresi kontrol edin." });
            }
            res.json({ success: true, message: "Onay kodu e-posta adresinize başarıyla gönderildi." });
        });
    } catch (error) { res.status(500).json({ error: "İşlem hatası." }); }
});

// 1. Şirket Kaydı (Adım 2: Kodu Doğrulama ve Kaydı Tamamlama)
app.post('/api/saas/register', async (req, res) => {
    try {
        const { companyName, email, username, password, code } = req.body;
        
        // Gelen kodu kontrol et
        const verification = await EmailVerificationModel.findOne({ email, code });
        if (!verification) {
            return res.status(400).json({ error: "Geçersiz veya süresi dolmuş onay kodu girdiniz." });
        }

        // Son güvenlik kontrolü
        const existing = await CompanyModel.findOne({ email });
        if (existing) return res.status(400).json({ error: "Bu E-Posta adresi zaten kayıtlı." });

        // Şirketi oluştur
        const newCompany = new CompanyModel({
            companyName, email, username,
            password: hashPassword(password),
            status: 'Pending',
            appData: { fabrikalar: [], uretimler: [], giderler: [], odemeler: [], vardiyalar: [], personel: [], pozisyonlar: [], stoklar: [], stokHareketleri: [], receteler: [], lotlar: [], notlar: [] }
        });
        await newCompany.save();
        
        // Kullanılan kodu veritabanından sil
        await EmailVerificationModel.deleteOne({ email });

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

// 7. Admin: Silme / Güncelleme
app.post('/api/saas/admin/delete', async (req, res) => {
    try {
        const { id } = req.body;
        const company = await CompanyModel.findById(id);
        if (company.status !== 'Suspended' && company.status !== 'Pending') return res.status(400).json({ error: "Sadece askıdaki şirketler silinebilir." });
        await CompanyModel.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Silme hatası." }); }
});

app.post('/api/saas/admin/update', async (req, res) => {
    try {
        await CompanyModel.findByIdAndUpdate(req.body.id, { status: req.body.status });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Hata" }); }
});

// Admin: Ödeme Sil
// Admin: Ödeme Sil (Geçmişe Kaydederek)
app.post('/api/saas/admin/delete-payment', async (req, res) => {
    try {
        const { id } = req.body;
        const payment = await PaymentModel.findById(id);
        if (payment) {
            await new PaymentLogModel({
                action: 'Silindi',
                companyName: payment.companyName,
                oldAmount: payment.amount,
                oldPeriod: payment.period
            }).save();
            await PaymentModel.findByIdAndDelete(id);
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Silme hatası." }); }
});

// Admin: Ödeme Güncelle (Geçmişe Kaydederek)
app.post('/api/saas/admin/update-payment', async (req, res) => {
    try {
        const { id, amount, period } = req.body;
        const payment = await PaymentModel.findById(id);
        if (payment) {
            await new PaymentLogModel({
                action: 'Düzenlendi',
                companyName: payment.companyName,
                oldAmount: payment.amount,
                newAmount: amount,
                oldPeriod: payment.period,
                newPeriod: period
            }).save();
            
            payment.amount = amount;
            payment.period = period;
            await payment.save();
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Güncelleme hatası." }); }
});

// Admin: Silinme ve Düzenleme Loglarını Getir
app.get('/api/saas/admin/payment-logs', async (req, res) => {
    try {
        const logs = await PaymentLogModel.find().sort({ logDate: -1 });
        res.json(logs);
    } catch (error) { res.status(500).json({ error: "Veri çekilemedi." }); }
});

// Admin: Tekil Log (Geçmiş) Silme
app.post('/api/saas/admin/delete-payment-log', async (req, res) => {
    try {
        const { id } = req.body;
        await PaymentLogModel.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Log silme hatası." }); }
});

// Admin: Tüm Logları (Geçmişi) Temizleme
app.post('/api/saas/admin/clear-payment-logs', async (req, res) => {
    try {
        await PaymentLogModel.deleteMany({}); // Koleksiyondaki tüm verileri siler
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Logları temizleme hatası." }); }
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
// Şirket: Şifremi Unuttum - Kod Gönder
app.post('/api/saas/forgot-password', async (req, res) => {
    try {
        const { username } = req.body;
        // Kullanıcı adı veya E-posta ile şirketi bul
        const company = await CompanyModel.findOne({ 
            $or: [{ username: username }, { email: username }] 
        });
        
        if (!company) return res.status(404).json({ error: "Bu bilgilere ait bir işletme bulunamadı." });

        // 6 haneli rastgele kod oluştur
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Kodu ve 15 dakikalık süreyi kaydet
        company.resetCode = resetCode;
        company.resetCodeExpire = Date.now() + 15 * 60 * 1000; 
        await company.save();

        // E-postayı gönder
        const mailOptions = {
            from: 'fabrikayonetimpaneli@gmail.com', // Kendi gönderici mailiniz
            to: company.email,
            subject: 'İşletme Yönetimi - Şifre Sıfırlama Kodu',
            text: `İşletme panelinize giriş şifrenizi sıfırlamak için kod talep ettiniz.\n\nSıfırlama Kodunuz: ${resetCode}\n\nBu kod 15 dakika boyunca geçerlidir.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) return res.status(500).json({ error: "E-posta gönderilemedi. Sunucu ayarlarını kontrol edin." });
            res.json({ success: true, message: "Sıfırlama kodu şirketinize ait e-posta adresine gönderildi." });
        });
    } catch (error) { res.status(500).json({ error: "Bir hata oluştu." }); }
});

// Şirket: Şifre Sıfırlama Kodu Doğrulama ve Şifre Değiştirme
app.post('/api/saas/reset-password', async (req, res) => {
    try {
        const { username, code, newPassword } = req.body;
        
        const company = await CompanyModel.findOne({ 
            $or: [{ username: username }, { email: username }], 
            resetCode: code, 
            resetCodeExpire: { $gt: Date.now() } 
        });

        if (!company) return res.status(400).json({ error: "Geçersiz veya süresi dolmuş kod girdiniz." });

        company.password = hashPassword(newPassword);
        company.resetCode = undefined;
        company.resetCodeExpire = undefined;
        await company.save();

        res.json({ success: true, message: "Şifreniz başarıyla değiştirildi. Şimdi giriş yapabilirsiniz." });
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

// İşletme İçi Yönetici: Şifremi Unuttum - Kod Gönder
app.post('/api/saas/internal-admin/forgot-password', async (req, res) => {
    try {
        const companyId = req.headers['company-id'];
        if (!companyId) return res.status(400).json({ error: "Şirket ID eksik." });
        
        // İlgili şirketi bul (E-postayı buradan alacağız)
        const company = await CompanyModel.findById(companyId);
        if (!company) return res.status(404).json({ error: "Şirket bulunamadı." });

        // 6 haneli rastgele kod oluştur
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Kodu ve geçerlilik süresini şirketin modeline kaydet
        company.resetCode = resetCode;
        company.resetCodeExpire = Date.now() + 15 * 60 * 1000;
        await company.save();

        const mailOptions = {
            from: 'fabrikayonetimpaneli@gmail.com', // Kendi gönderici mailiniz
            to: company.email,
            subject: 'İşletme Yönetici Paneli - Şifre Sıfırlama Kodu',
            text: `İşletme içi yönetici panelinizin şifresini sıfırlamak için kod talep ettiniz.\n\nSıfırlama Kodunuz: ${resetCode}\n\nBu kod 15 dakika geçerlidir.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) return res.status(500).json({ error: "E-posta gönderilemedi." });
            res.json({ success: true, message: "Sıfırlama kodu işletmenizin kayıtlı e-posta adresine başarıyla gönderildi." });
        });
    } catch (error) { res.status(500).json({ error: "Bir hata oluştu." }); }
});

// İşletme İçi Yönetici: Kodu Doğrula
app.post('/api/saas/internal-admin/verify-code', async (req, res) => {
    try {
        const companyId = req.headers['company-id'];
        const { code } = req.body;
        
        const company = await CompanyModel.findOne({ 
            _id: companyId, 
            resetCode: code, 
            resetCodeExpire: { $gt: Date.now() } 
        });

        if (!company) return res.status(400).json({ error: "Geçersiz veya süresi dolmuş kod girdiniz." });

        // Kullanılan kodu temizle
        company.resetCode = undefined;
        company.resetCodeExpire = undefined;
        await company.save();

        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Bir hata oluştu." }); }
});




app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});

