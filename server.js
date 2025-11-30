/**
 * FABRIKA YÖNETİM PANELİ - BULUT VERİTABANI VERSİYONU
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- MONGODB BAĞLANTISI ---
const MONGO_URI = process.env.MONGO_URI; 

if (!MONGO_URI) {
    console.error("HATA: .env dosyasında MONGO_URI bulunamadı!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ MongoDB Veritabanına Başarıyla Bağlandı!"))
        .catch(err => console.error("❌ Bağlantı Hatası:", err));
}

// --- VERİ MODELİ ---
const DataSchema = new mongoose.Schema({
    docName: { type: String, default: 'mainData' },
    data: { type: Object, default: {} }
});
const DataModel = mongoose.model('FabrikaData', DataSchema);

const DEFAULT_DATA = { 
    fabrikalar: [], uretimler: [], giderler: [], 
    odemeler: [], vardiyalar: [], personel: [], pozisyonlar: [] 
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- API ENDPOINTLERİ ---
app.get('/api/data', async (req, res) => {
    try {
        let doc = await DataModel.findOne({ docName: 'mainData' });
        if (!doc) {
            doc = new DataModel({ docName: 'mainData', data: DEFAULT_DATA });
            await doc.save();
        }
        res.json(doc.data || DEFAULT_DATA);
    } catch (error) {
        console.error("Okuma Hatası:", error);
        res.status(500).json({ error: "Sunucu hatası" });
    }
});

app.post('/api/data', async (req, res) => {
    try {
        await DataModel.findOneAndUpdate(
            { docName: 'mainData' },
            { data: req.body },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        console.error("Yazma Hatası:", error);
        res.status(500).json({ error: "Kaydedilemedi" });
    }
});

app.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});