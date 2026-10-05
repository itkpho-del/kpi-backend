// src/middlewares/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Mengambil string setelah 'Bearer'

  if (!token) {
     res.status(403).json({ success: false, message: 'Akses ditolak, token tidak tersedia.' });
     return;
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    (req as any).user = verified;
    next(); // Lanjut ke fungsi berikutnya jika token valid
  } catch (error) {
     res.status(401).json({ success: false, message: 'Token tidak valid atau kadaluwarsa.' });
  }
};