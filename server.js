/**
 * FABRIKA YÖNETİM PANELİ - SAAS VERSİYONU (TAM PROJE)
 * Abonelik, Ödeme, Kayıt, Yönetici ve Çoklu Şirket Sistemi
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');

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
const AdminSchema = new mongoose.Schema({ username: String, password: String });
const AdminModel = mongoose.model('SystemAdmin', AdminSchema);

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
    if (admin) res.json({ success: true, username: admin.username });
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

app.post('/api/saas/admin/update-credentials', async (req, res) => {
    try {
        const { newUsername, newPassword } = req.body;
        const admin = await AdminModel.findOne();
        if (newUsername) admin.username = newUsername;
        if (newPassword) admin.password = hashPassword(newPassword);
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

// --- GEÇİCİ ŞİFRE SIFIRLAMA KODU (İşlem bitince bu kısmı silin) ---
setTimeout(async () => {
    try {
        console.log("⏳ Yönetici şifresi sıfırlanıyor...");
        
        // Şifreyi şifrele (Hash)
        const newPasswordHash = crypto.createHash('sha256').update("master123").digest('hex');
        
        // Veritabanındaki ilk yöneticiyi bul ve güncelle
        // Eğer yönetici yoksa (upsert: true) yeni bir tane oluşturur.
        await AdminModel.findOneAndUpdate(
            {}, // İlk bulduğunu al
            { username: "master", password: newPasswordHash },
            { upsert: true, new: true }
        );

        console.log("✅ BAŞARILI! Şifreniz sıfırlandı.");
        console.log("👉 Kullanıcı Adı: master");
        console.log("👉 Şifre: master123");
        console.log("⚠️ LÜTFEN ŞİMDİ BU EKLEDİĞİNİZ KODU SİLİN VE SUNUCUYU TEKRAR BAŞLATIN.");
    } catch (error) {
        console.error("Şifre sıfırlama hatası:", error);
    }
}, 3000); // Sunucu açıldıktan 3 saniye sonra çalışır

app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});