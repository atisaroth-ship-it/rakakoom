# ติดตั้งระบบเก็บราคาบน Oracle Cloud Always Free

ต้องทำก่อน: P1–P4 ในแผน `docs/superpowers/plans/2026-10-26-price-collector.md`

## 1. ตรวจโควตาฟรีก่อนสร้างอะไร
เปิดหน้า Always Free Resources ของ Oracle แล้วยืนยันว่ายังได้:
- Ampere A1 รวม 2 OCPU / RAM 12 GB
- Block Volume รวม 200 GB
- **Object Storage ฟรีและได้กี่ GB** — ถ้าไม่ฟรีแล้ว หยุดและถามแม่หมอก่อน (ใช้สำรองข้อมูล)

## 2. สร้างเครื่อง
- Compute → Create instance, shape `VM.Standard.A1.Flex` 2 OCPU / 12 GB, image Ubuntu 24.04 (aarch64)
- Boot volume 150 GB (เหลือโควตา 50 GB)
- Security list เปิดเฉพาะพอร์ต 22 (SSH) — ระบบเก็บราคาไม่ต้องรับการเชื่อมต่อจากภายนอก
- ถ้าขึ้นว่า "Out of capacity" ให้ลองใหม่ภายหลังหรือเลือก availability domain อื่น

## 3. คัดลอกโค้ดขึ้นเครื่อง
จากเครื่องที่มีโปรเจกต์ (ไม่ต้องคัดลอก `node_modules`):
```bash
git archive --format=tar.gz -o rakakoom.tgz HEAD
scp rakakoom.tgz ubuntu@<IP>:/tmp/
ssh ubuntu@<IP> 'sudo mkdir -p /opt/rakakoom && sudo tar -xzf /tmp/rakakoom.tgz -C /opt/rakakoom'
```

## 4. ติดตั้ง
```bash
sudo bash /opt/rakakoom/deploy/setup.sh
```
ครั้งแรกสคริปต์จะสร้าง `/etc/rakakoom.env` ให้ แก้ด้วย `sudo nano /etc/rakakoom.env` แล้ว**ใส่ค่าในเครื่องหมายคำพูดคู่**:
```
FEED_URLS="<ลิงก์ฟีดไฟล์ 1>,<ลิงก์ฟีดไฟล์ 2>"
LINE_CHANNEL_ACCESS_TOKEN="..."
ADMIN_LINE_USER_ID="U..."
HEALTHCHECK_URL="https://hc-ping.com/<uuid>"
BACKUP_PAR_URL="https://objectstorage.ap-singapore-1.oraclecloud.com/p/<token>/n/<namespace>/b/<bucket>/o/"
```
แล้วรัน `setup.sh` อีกรอบ ไฟล์นี้เป็นความลับ (สิทธิ์ 600) ห้ามคัดลอกไปที่อื่น

## 5. ที่เก็บสำรองข้อมูล
- Storage → Buckets → สร้าง bucket `rakakoom-backups` (Standard, private)
- Lifecycle rule: Delete objects older than 14 days
- Pre-Authenticated Request: ระดับ bucket, อนุญาต "Permit object writes", วันหมดอายุไกล ๆ (เช่น 2 ปี — **ตั้งเตือนในปฏิทินให้ต่ออายุ**) → ใส่เป็น `BACKUP_PAR_URL`

## 6. ทดสอบ (ทำครบทุกข้อ)
1. เก็บราคาจริง:
   ```bash
   sudo systemctl start rakakoom-collect.service
   journalctl -u rakakoom-collect -n 5
   sudo -u rakakoom psql rakakoom -c "select feed_date, status, rows_read, rows_kept from feed_runs"
   ```
   ต้องเห็น `"status":"success"` และ `rows_read` ประมาณ 2,000,000
2. การแจ้งเตือน: ใส่ `FEED_URLS="https://example.invalid/x"` ชั่วคราว → `sudo systemctl start rakakoom-collect.service` → แม่หมอต้องได้ข้อความ LINE "ล้มเหลว" และ healthchecks ขึ้น fail → คืนค่าเดิม
   (ถ้าวันนั้นเก็บสำเร็จไปแล้ว รอบทดสอบจะถูกข้าม ให้ทดสอบข้อนี้ก่อนข้อ 1 หรือทดสอบวันถัดไป)
3. สำรองข้อมูล: `sudo systemctl start rakakoom-backup.service` → มีไฟล์ใน bucket แล้วลองกู้:
   ```bash
   sudo -u postgres createdb -O rakakoom restore_check
   sudo -u rakakoom pg_restore -d restore_check /path/to/downloaded.dump
   sudo -u rakakoom psql restore_check -c "select count(*) from price_changes"
   ```
   จำนวนต้องเท่ากับฐานข้อมูลจริง แล้ว `dropdb restore_check`
4. ดูตารางเวลา: `systemctl list-timers 'rakakoom-*'`

## 7. ผลจากรอบจริงครั้งแรก (กรอกหลังติดตั้ง)
- เวลาที่ใช้ต่อรอบ: _
- ขนาดฐานข้อมูล (`select pg_size_pretty(pg_database_size('rakakoom'))`): _
- คาดว่าดิสก์ 150 GB พอประมาณ: _ วัน
