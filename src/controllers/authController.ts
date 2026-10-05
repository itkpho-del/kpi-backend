// src/controllers/authController.ts
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { RowDataPacket } from 'mysql2';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// 1. LOGIKA LOGIN DARI DATABASE
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_kode, user_password } = req.body;

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM tuser WHERE user_kode = ? AND user_password = ? LIMIT 1',
      [user_kode, user_password]
    );

    if (rows.length === 0) {
      res.status(401).json({ success: false, message: 'Kode User atau Password salah!' });
      return;
    }

    const userObj = rows[0];

    if (!userObj) {
      res.status(404).json({ success: false, message: 'User tidak ditemukan' });
      return; // 💡 Cukup tulis return kosong seperti ini untuk menghentikan fungsi
    }
    const token = jwt.sign(
      { user_kode: userObj.user_kode, nama: userObj.user_nama },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      success: true,
      token,
      user: {
        user_kode: userObj.user_kode,
        user_nama: userObj.user_nama,
        user_akses: userObj.user_akses
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke database.' });
  }
};

// 2. LOGIKA AMBUL DATA DASHBOARD DARI DATABASE
export const getDashboardSummary = async (req: Request, res: Response): Promise<void> => {
  const connection = await pool.getConnection();

  try {
    const bulan = req.query.bulan as string;
    const tahun = req.query.tahun as string;

    if (!bulan || !tahun) {
      res.status(400).json({ success: false, message: 'Parameter bulan dan tahun wajib diisi.' });
      return;
    }
    // Hitung tanggal 1 bulan berikutnya di sisi Node.js (Murni string standar YYYY-MM-DD)
    const tanggalJs = new Date(parseInt(tahun), parseInt(bulan) - 1, 1);
    tanggalJs.setMonth(tanggalJs.getMonth() + 1);

    const tahunDepan = tanggalJs.getFullYear();
    const bulanDepan = String(tanggalJs.getMonth() + 1).padStart(2, '0');
    const tanggalAwalBulan = `${tahunDepan}-${bulanDepan}-01`;

    console.log(`LOG: Menerima request KPI untuk Periode Bulan: ${bulan}, Tahun: ${tahun}, Tanggal: ${tanggalAwalBulan}`);

    // 2. Daftarkan variabel sesi ke MySQL (Driver otomatis mengamankan string dengan petik di background)
    await connection.query(
      `SET @p1 = ?, 
           @p2 = ?, 
           @tgl = ?`,
      [bulan, tahun, tanggalAwalBulan]
    );

    // 🕵️‍♂️ Debugging internal backend untuk memastikan variabel masuk ke MySQL
    const [debugRows] = await connection.query<any[]>('SELECT @p1 AS p1, @p2 AS p2, @tgl AS tgl');
    console.log(`DATABASE_CHECK -> @p1: ${debugRows[0].p1}, @p2: ${debugRows[0].p2}, @tgl: ${debugRows[0].tgl}`);

    // 3. Jalankan Query Utama (Menggunakan ALIAS HURUF KECIL / snake_case agar sinkron dengan template Vue)
    const queryUtama = `
  
  SELECT COUNT(*) total_karyawan,
COUNT(if(floor(nilai)=1,1,NULL)) nilai1,
COUNT(if(floor(nilai)=2,1,NULL)) nilai2,
COUNT(if(floor(nilai)=3,1,NULL)) nilai3,
COUNT(if(floor(nilai)=4,1,NULL)) nilai4,
avg(nilai) ratarata
FROM (
      SELECT tahun, bulan,
        nik, nama, jabatan, pabrik, bagian, departemen, 
        sistem_gaji, tgl_masuk, tgl_keluar, 
        terlambat, adaform, tanpa_form, alpha, setengah_hari, meninggalkan, sp, 
        IFNULL(nilai, 0) AS nilai 
      FROM (
        SELECT 
          tahun,
          bulan,        
          kar_nik AS nik, 
          kar_nama AS nama, 
          jab_nama AS jabatan, 
          kar_pab_kode AS pabrik,
          kar_bagian AS bagian,
          dep_nama AS departemen, 
          kar_sistem_gaji AS sistem_gaji, 
          kar_tgl_masuk AS tgl_masuk, 
          kar_tgl_keluar AS tgl_keluar, 
          jml AS terlambat, 
          adaform, 
          IF(jml > adaform, jml - adaform, 0) AS tanpa_form, 
          alpha, 
          setengah AS setengah_hari, 
          meninggalkan, 0 sp,
          IF((jml <= 2 AND jml - adaform <= 0) AND alpha <= 0 AND setengah <= 2 AND meninggalkan <= 2, 4, 
          IF((jml <= 3 AND jml - adaform <= 0) AND alpha <= 0 AND setengah <= 3 AND meninggalkan <= 3, 3, 
          IF((jml <= 4 AND jml - adaform <= 1) AND alpha <= 1 AND setengah <= 4 AND meninggalkan <= 4, 2, 
          IF((jml <= 5 AND jml - adaform <= 2) AND alpha <= 2 AND setengah <= 5 AND meninggalkan <= 5, 1, 0))))
          AS nilai 
        FROM kedisiplinan
        INNER JOIN tjabatan ON jab_kode = kar_jab_kode
        INNER JOIN tdepartemen ON dep_kode = kar_Dep_kode
      ) final
      WHERE jabatan NOT IN ("", "manager", "direktur")
      ) zz     `;

  console.log(queryUtama);
    // Eksekusi query utama
    const [rows] = await connection.query(queryUtama);

    // 4. Kirim data kembali ke frontend Vue
    res.json({
      success: true,
      data: rows
    });

  } catch (error: any) {
    // Menangkap detail error query tanpa memutus koneksi/membuat server hang
    console.error('🔥 TERJADI ERROR PADA PROSES EXECUTE QUERY DI MYSQL:');
    console.error('Pesan Error:', error.message);
    console.error('----------------------------------------------------');

    res.status(500).json({ success: false, message: 'Gagal mengambil data dashboard.' });
  } finally {
    // 5. Kembalikan koneksi ke pool
    connection.release();
  }
};

// 3. LOGIKA KPI KEDISIPLINAN
// src/controllers/authController.ts

export const getKpiKedisiplinan = async (req: Request, res: Response): Promise<void> => {
  // 1. Ambil 1 slot koneksi khusus dari pool agar berada dalam SATU SESI KONEKSI yang sama
  const connection = await pool.getConnection();

  try {
    const bulan = req.query.bulan as string;
    const tahun = req.query.tahun as string;

    if (!bulan || !tahun) {
      res.status(400).json({ success: false, message: 'Parameter bulan dan tahun wajib diisi.' });
      return;
    }

    // Hitung tanggal 1 bulan berikutnya di sisi Node.js (Murni string standar YYYY-MM-DD)
    const tanggalJs = new Date(parseInt(tahun), parseInt(bulan) - 1, 1);
    tanggalJs.setMonth(tanggalJs.getMonth() + 1);

    const tahunDepan = tanggalJs.getFullYear();
    const bulanDepan = String(tanggalJs.getMonth() + 1).padStart(2, '0');
    const tanggalAwalBulan = `${tahunDepan}-${bulanDepan}-01`;

    console.log(`LOG: Menerima request KPI untuk Periode Bulan: ${bulan}, Tahun: ${tahun}, Tanggal: ${tanggalAwalBulan}`);

    // 2. Daftarkan variabel sesi ke MySQL (Driver otomatis mengamankan string dengan petik di background)
    await connection.query(
      `SET @p1 = ?, 
           @p2 = ?, 
           @tgl = ?`,
      [bulan, tahun, tanggalAwalBulan]
    );

    // 🕵️‍♂️ Debugging internal backend untuk memastikan variabel masuk ke MySQL
    const [debugRows] = await connection.query<any[]>('SELECT @p1 AS p1, @p2 AS p2, @tgl AS tgl');
    console.log(`DATABASE_CHECK -> @p1: ${debugRows[0].p1}, @p2: ${debugRows[0].p2}, @tgl: ${debugRows[0].tgl}`);

    // 3. Jalankan Query Utama (Menggunakan ALIAS HURUF KECIL / snake_case agar sinkron dengan template Vue)
    const queryUtama = `
      SELECT tahun, bulan,
        nik, nama, jabatan, pabrik, bagian, departemen, 
        sistem_gaji, tgl_masuk, tgl_keluar, 
        terlambat, adaform, tanpa_form, alpha, setengah_hari, meninggalkan, sp, 
        IFNULL(nilai, 0) AS nilai 
      FROM (
        SELECT 
          tahun,
          bulan,        
          kar_nik AS nik, 
          kar_nama AS nama, 
          jab_nama AS jabatan, 
          kar_pab_kode AS pabrik,
          kar_bagian AS bagian,
          dep_nama AS departemen, 
          kar_sistem_gaji AS sistem_gaji, 
          kar_tgl_masuk AS tgl_masuk, 
          kar_tgl_keluar AS tgl_keluar, 
          jml AS terlambat, 
          adaform, 
          IF(jml > adaform, jml - adaform, 0) AS tanpa_form, 
          alpha, 
          setengah AS setengah_hari, 
          meninggalkan, 0 sp,
          IF((jml <= 2 AND jml - adaform <= 0) AND alpha <= 0 AND setengah <= 2 AND meninggalkan <= 2, 4, 
          IF((jml <= 3 AND jml - adaform <= 0) AND alpha <= 0 AND setengah <= 3 AND meninggalkan <= 3, 3, 
          IF((jml <= 4 AND jml - adaform <= 1) AND alpha <= 1 AND setengah <= 4 AND meninggalkan <= 4, 2, 
          IF((jml <= 5 AND jml - adaform <= 2) AND alpha <= 2 AND setengah <= 5 AND meninggalkan <= 5, 1, 0))))
          AS nilai 
        FROM kedisiplinan
        INNER JOIN tjabatan ON jab_kode = kar_jab_kode
        INNER JOIN tdepartemen ON dep_kode = kar_Dep_kode
      ) final
      WHERE jabatan NOT IN ("", "manager", "direktur")
    `;

  console.log(queryUtama);
    // Eksekusi query utama
    const [rows] = await connection.query(queryUtama);

    // 4. Kirim data kembali ke frontend Vue
    res.json({
      success: true,
      data: rows
    });

  } catch (error: any) {
    // Menangkap detail error query tanpa memutus koneksi/membuat server hang
    console.error('🔥 TERJADI ERROR PADA PROSES EXECUTE QUERY DI MYSQL:');
    console.error('Pesan Error:', error.message);
    console.error('----------------------------------------------------');

    res.status(500).json({ success: false, message: 'Gagal mengambil data KPI Kedisiplinan.' });
  } finally {
    // 5. Kembalikan koneksi ke pool
    connection.release();
  }
};

// 4. LOGIKA KPI PRODUKTIVITAS
// src/controllers/authController.ts


export const getKpiProduktivitas = async (req: Request, res: Response): Promise<void> => {
  // 1. Ambil 1 slot koneksi khusus dari pool
  const connection = await pool.getConnection();

  try {
    const bulan = req.query.bulan as string;
    const tahun = req.query.tahun as string;

    if (!bulan || !tahun) {
      res.status(400).json({ success: false, message: 'Parameter bulan dan tahun wajib diisi.' });
      return;
    }

    console.log(`LOG: Menerima request KPI untuk Periode Bulan: ${bulan}, Tahun: ${tahun}`);

    // 2. Jalankan Query Utama (Menggunakan ALIAS agar sinkron dengan template Vue)
    // Semua kondisi hardcode tahun/bulan telah diganti dengan placeholder (?)
    const queryUtama = `
      SELECT ? tahun, ? bulan, kar_nik nik, kar_nama nama, kar_jab_kode jabatan, kar_pab_kode pabrik, kar_dep_kode departemen, kar_bagian bagian,
        kar_tgl_keluar tgl_keluar, rp_target target, rp_realisasi realisasi, ach,
        if(ach>=95,4, if(ach>=85,3, if(ach>=71,2,1))) nilai
      FROM hrd2.tkaryawan 
      INNER JOIN (
        SELECT * FROM kencanaprint.v_ach_mkt WHERE tahun=? AND bulan=?
        ORDER BY rp_target DESC LIMIT 1
      ) a
      WHERE kar_status_aktif=1 
      AND kar_dep_kode IN ("fin","mkt","hrd","ppic") 

      UNION ALL 

      SELECT ? tahun, ? bulan, kar_nik Nik, kar_nama Nama, kar_jab_kode, kar_pab_kode Pabrik, kar_dep_kode, kar_bagian Bagian, 
        kar_tgl_keluar Tgl_keluar, target, nominal, ach, 
        if(ach>=95,4, if(ach>=85,3, if(ach>=71,2,1))) nilai 
      FROM hrd2.tkaryawan 
      INNER JOIN (
        SELECT a.tahun, a.bulan, a.kode_gudang, a.nama_gudang, 
          ifnull(a.target_omset,0) target, 
          ifnull(b.nominal,0) nominal, 
          if(ifnull(a.target_omset,0)=0 OR IFNULL(b.nominal,0)=0,0,ROUND(b.nominal/a.target_omset*100,2)) ach 
        FROM (
          SELECT tahun, bulan, kode_gudang, nama_gudang, sum(ifnull(target_omset,0)) target_omset 
          FROM kpi.ttarget_kaosan 
          GROUP BY 1,2,3 
        ) a 
        LEFT JOIN ( 
          SELECT year(tanggal) tahun, MONTH(tanggal) bulan, cabang, gdg_nama, 
            SUM(ifnull(jumlah,0)) jumlah, 
            SUM(ifnull(nominal,0)) nominal 
          FROM retail.v_sales_harian GROUP BY 1,2,3 
        ) b ON (b.tahun=a.tahun AND b.bulan=a.bulan AND b.cabang=a.kode_gudang) 
        WHERE a.tahun=? AND a.bulan=?
      ) a ON (kode_gudang=kar_pab_kode) 
      WHERE kar_status_aktif=1 AND kar_dep_kode IN ("mktr") 

      UNION ALL 

      SELECT ? tahun, ? bulan, kar_nik Nik, kar_nama Nama, kar_jab_kode, kar_pab_kode Pabrik, kar_dep_kode, kar_bagian Bagian, 
        kar_tgl_keluar Tgl_keluar, target, nominal, ach, 
        if(ach>=95,4, if(ach>=85,3, if(ach>=71,2,1))) nilai 
      FROM hrd2.tkaryawan 
      INNER JOIN (
        SELECT a.tahun, a.bulan, "HO" kode_gudang, "Head Office" nama_gudang, 
          ifnull(a.target_omset,0) target, 
          ifnull(b.nominal,0) nominal, 
          if(ifnull(a.target_omset,0)=0 OR IFNULL(b.nominal,0)=0,0,ROUND(b.nominal/a.target_omset*100,2)) ach 
        FROM (
          SELECT tahun, bulan, "HO" kode_gudang, "Head Office" nama_gudang, sum(ifnull(target_omset,0)) target_omset 
          FROM kpi.ttarget_kaosan 
          GROUP BY 1,2,3 
        ) a 
        LEFT JOIN ( 
          SELECT year(tanggal) tahun, MONTH(tanggal) bulan, "HO" cabang, "Head Office" gdg_nama, 
            SUM(ifnull(jumlah,0)) jumlah, 
            SUM(ifnull(nominal,0)) nominal 
          FROM retail.v_sales_harian GROUP BY 1,2,3 
        ) b ON (b.tahun=a.tahun AND b.bulan=a.bulan AND b.cabang=a.kode_gudang) 
        WHERE a.tahun=? AND a.bulan=?
      ) a ON (kode_gudang=kar_pab_kode) 
      WHERE kar_status_aktif=1 AND kar_dep_kode IN ("mktr") 

      UNION ALL

      SELECT X.*, y.tp_Target, z.jumlah, round(z.jumlah/y.tp_Target*100,2) ach,
        if(round(z.jumlah/y.tp_Target*100,2)>=95,4, 
        if(round(z.jumlah/y.tp_Target*100,2)>=85,3, 
        if(round(z.jumlah/y.tp_Target*100,2)>=71,2,1))) nilai 
      FROM (
        SELECT ? tahun, ? bulan, kar_nik Nik, kar_nama Nama, kar_jab_kode, kar_pab_kode Pabrik, kar_dep_kode, kar_bagian Bagian,
          kar_tgl_keluar Tgl_keluar
        FROM hrd2.tkaryawan
        WHERE kar_status_aktif=1
        AND kar_dep_kode NOT IN ("fin","mkt","hrd","ppic","mktr")
      ) x 
      INNER JOIN (
        SELECT tp_pab_kode, tp_pab_nama, tp_keterangan, tp_tahun, tp_bulan, tp_Target, tp_satuan 
        FROM kencanaprint.ttarget_produksi
        WHERE tp_tahun=? AND tp_bulan=?
      ) y ON (y.tp_pab_kode=x.Pabrik)
      INNER JOIN (
        SELECT tahun, bulan, gdgp_cab, jumlah from kencanaprint.v_outputproduksi
        WHERE tahun=? AND bulan=?
      ) z ON (z.gdgp_cab=x.Pabrik)
    `;

    // 3. Susun array parameter tepat berurutan sesuai tanda tanya (?) pada query di atas (Total ada 8 pasang = 16 item)
    const queryParams = [
      tahun, bulan, // Placeholder untuk v_ach_mkt
      tahun, bulan, // Placeholder untuk ttarget_kaosan cabang
      tahun, bulan, // Placeholder untuk ttarget_kaosan HO
      tahun, bulan, // Placeholder untuk ttarget_produksi (Sebelumnya hardcode 2026 & 6)
      tahun, bulan,  // Placeholder untuk v_outputproduksi
      tahun, bulan, // Placeholder untuk v_ach_mkt
      tahun, bulan, // Placeholder untuk ttarget_kaosan cabang
      tahun, bulan, // Placeholder untuk ttarget_kaosan HO
      tahun, bulan, // Placeholder untuk ttarget_produksi (Sebelumnya hardcode 2026 & 6)
      tahun, bulan  // Placeholder untuk v_outputproduksi
      
    ];

    // Eksekusi query utama
  
    const sqlTerformat = connection.format(queryUtama, queryParams);
    
    console.log("==================== [ LOG SQL EXECUTE ] ====================");
    console.log(sqlTerformat);
    console.log("=============================================================");
    //const [rows] = await connection.query(queryUtama, queryParams);
    const [rows] = await connection.query(sqlTerformat);

    // 4. Kirim data kembali ke frontend Vue
    res.json({
      success: true,
      data: rows
    });

  } catch (error: any) {
    console.error('🔥 TERJADI ERROR PADA PROSES EXECUTE QUERY DI MYSQL:');
    console.error('Pesan Error:', error.message);
    console.error('----------------------------------------------------');

    res.status(500).json({ success: false, message: 'Gagal mengambil data KPI Produktivitas.' });
  } finally {
    // 5. Kembalikan koneksi ke pool agar tidak terjadi kebocoran koneksi (connection leak)
    connection.release();
  }
};