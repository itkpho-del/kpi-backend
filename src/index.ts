// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { login, getDashboardSummary, getKpiKedisiplinan, getKpiProduktivitas } from './controllers/authController';
import { verifyToken } from './middlewares/authMiddleware';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// MIDDLEWARE UTAMA
app.use(cors()); // 🔑 Ini yang mencegah error CORS pada Vue 3 kamu
app.use(express.json()); // Agar server bisa membaca format JSON dari Axios

// ENDPOINT API
app.post('/api/login', login);
app.get('/api/dashboard-summary', verifyToken, getDashboardSummary); // Diproteksi oleh token
app.get('/api/kpi-kedisiplinan', verifyToken, getKpiKedisiplinan);
app.get('/api/kpi-produktivitas', verifyToken, getKpiProduktivitas);
// JALANKAN SERVER
app.listen(PORT, () => {
  console.log(`⚡️ Server Backend berjalan di http://localhost:${PORT}`);
});