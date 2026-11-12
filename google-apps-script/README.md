# phumintr888 — Google Sites + Google Sheets

เวอร์ชันนี้เพิ่มบัญชีผู้ใช้และซิงก์ข้อมูลกับ Google Sheets
โดยหน้าเว็บถูกเสิร์ฟจาก Google Apps Script เพื่อให้ฝังใน Google Sites ได้โดยไม่ติด CORS

## ลิงก์ที่เกี่ยวข้อง

- Apps Script editor: https://script.google.com/d/1RgN_ttfKsJiSgi9P9BUE3YNdzuIFQ6pAi7zx2S1EsCzNlbYyUVPAM__q/edit
- Web App URL: https://script.google.com/macros/s/AKfycbztTjWs9gUaHQjk6lkPeOeh1PA9I-4QhrrNbkBIKcXVe8ccHiNytQZVh6MYffwyLJRhsQ/exec
- GitHub Pages (เวอร์ชันเดิมที่เก็บข้อมูลในเบราว์เซอร์): https://thunwa-leo.github.io/phumintr888/

## ต้องทำหนึ่งครั้ง: อนุญาต Google Sheets

ตอนนี้ Web App ยังตอบ `403` เพราะเจ้าของสคริปต์ยังไม่ได้อนุญาตสิทธิ์ Google Sheets/Drive

1. เปิด Apps Script editor ลิงก์ด้านบน
2. เลือกฟังก์ชัน `setup` จากรายการด้านบน แล้วกด **Run**
3. กด **Review permissions** → เลือกบัญชี Google → **Advanced** → **Go to phumintr888 Sheets (unsafe)** → **Allow**
4. รอจน Execution log ขึ้นข้อมูลสเปรดชีต
5. ระบบจะสร้างไฟล์ **phumintr888 Database** ใน Google Drive อัตโนมัติ
6. เปิด Web App URL ลิงก์ด้านบน แล้วสมัคร/เข้าสู่ระบบได้เลย

> หน้า “unsafe” เป็นข้อความปกติของแอปที่ยังไม่ผ่าน Google verification
> โค้ดทั้งหมดอยู่ในโปรเจกต์ Apps Script นี้และสามารถตรวจสอบได้

## การใช้งานบัญชี

- กรอกชื่อผู้ใช้ 3–30 ตัวอักษร และรหัสผ่าน 6 ตัวอักษรขึ้นไป
- ถ้าชื่อผู้ใช้ยังไม่มีในระบบ ระบบจะ **สร้างบัญชีใหม่ให้อัตโนมัติ**
- รหัสผ่านถูกเก็บเป็น salted SHA-256 hash ไม่ได้เก็บเป็นข้อความธรรมดา
- มีเซสชันแยกต่ออุปกรณ์ อายุ 30 วัน
- ยังไม่มีระบบลืมรหัสผ่าน/รีเซ็ตรหัสผ่าน

## โครงสร้าง Google Sheets

สคริปต์จะสร้างสเปรดชีตและชีตเหล่านี้ให้อัตโนมัติ:

- `Users` — ชื่อผู้ใช้, password hash, salt, เวลาสมัคร, จำนวนครั้งที่ล็อกอินผิด
- `Sessions` — token ของแต่ละอุปกรณ์และวันหมดอายุ
- `Data` — JSON ของตารางเรียน/การบ้าน แยกตาม username

ข้อมูลรูปตารางเรียนจะไม่ถูกเก็บใน Sheets เพราะเกินขีดจำกัดของเซลล์
รูปจะยังอยู่ในเบราว์เซอร์ของอุปกรณ์นั้น

## ฝังใน Google Sites

1. เปิดหน้า Google Sites ที่ต้องการ
2. **Insert → Embed → By URL**
3. วาง Web App URL ด้านบน
4. ตั้งความสูงประมาณ 900 px แล้ว Publish

หาก Google Sites ไม่แสดงหน้า ให้เข้า Apps Script → **Deploy → Manage deployments**
และตรวจว่า Who has access เป็น **Anyone**

## อัปเดตโค้ด

```bash
cd google-apps-script
npx @google/clasp push -f
npx @google/clasp version "v3"
npx @google/clasp deploy -V 3 -d "description" -i <deploymentId>
```

หรือ deploy ใหม่ผ่าน Apps Script editor → Deploy → New deployment → Web app
