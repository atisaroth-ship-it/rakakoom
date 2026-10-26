# ติดตั้งระบบเก็บราคาบน Google Cloud (e2-micro ฟรี)

ต้องทำก่อน: P2–P4 ในแผน `docs/superpowers/plans/2026-10-26-price-collector.md` (LINE token, user ID, healthchecks.io)

## 0. เงื่อนไขฟรีที่ต้องอยู่ในกรอบ (เช็คจากหน้า Free Tier ของ Google เมื่อ 26 ต.ค. 2026)
- เครื่อง `e2-micro` 1 เครื่อง ใน **us-west1, us-central1 หรือ us-east1 เท่านั้น**
- ดิสก์ **standard persistent disk** รวม 30 GB (ดิสก์ชนิด balanced/SSD **ไม่ฟรี**)
- ส่งข้อมูลออก 1 GB/เดือน (การดาวน์โหลดฟีดเป็นขาเข้า ไม่นับ)
- Cloud Storage แบบ regional 5 GB/เดือน ในสามภูมิภาคข้างบน
- **ยังไม่แน่ใจ:** ค่า IP สาธารณะของเครื่อง ข้อมูลเก่าบอกว่าเครื่องในกรอบฟรีไม่เสียค่า IP แต่ยังยืนยันจากหน้าทางการไม่ได้ → ต้องตั้งงบเตือนในข้อ 1 แล้วเช็คหน้า Billing หลังใช้ 2–3 วัน

## 1. บัญชีและงบเตือน (แม่หมอทำเอง)
1. สมัคร Google Cloud ผูกบัตรตอนสร้าง billing account
2. Billing → Budgets & alerts → สร้างงบ **1 USD** เตือนที่ 50% และ 100% → ถ้ามีค่าใช้จ่ายโผล่ขึ้นมา จะรู้ทันที

## 2. ที่เก็บสำรองข้อมูล
1. Cloud Storage → Create bucket: ชื่อเช่น `rakakoom-backups-<อะไรก็ได้>`, Location type **Region** = ภูมิภาคเดียวกับเครื่อง (เช่น `us-central1`), Storage class **Standard**, ปิด public access
2. ใส่ชื่อเป็น `BACKUP_BUCKET="gs://<ชื่อ bucket>"` ในข้อ 5
3. เก็บไว้ 2 ไฟล์ล่าสุด (`BACKUP_KEEP=2`) ให้อยู่ในโควตา 5 GB — ถ้าไฟล์สำรองใหญ่เกิน 2.5 GB ต้องลดเหลือ 1 (ดูขนาดในข้อ 7)

## 3. สร้างเครื่อง
Compute Engine → VM instances → Create instance:
- Region: ภูมิภาคเดียวกับ bucket, Machine type: **e2-micro**
- Boot disk: **Ubuntu 24.04 LTS (x86/64)**, ชนิด **Standard persistent disk**, ขนาด **30 GB**
- Identity and API access: Service account = Compute Engine default, Access scopes = **Set access for each API → Storage: Read Write**
- Firewall: ไม่ต้องติ๊ก HTTP/HTTPS (ระบบเก็บราคาไม่รับการเชื่อมต่อจากภายนอก)
- หลังสร้าง: IAM & Admin → IAM → ให้ service account ของเครื่องมีสิทธิ์ **Storage Object Admin** (หรือให้เฉพาะที่ bucket)

## 4. คัดลอกโค้ดขึ้นเครื่อง
จากเครื่องที่มีโปรเจกต์ (ไม่ต้องคัดลอก `node_modules`):
```bash
git archive --format=tar.gz -o rakakoom.tgz HEAD
gcloud compute scp rakakoom.tgz <ชื่อเครื่อง>:/tmp/ --zone <zone>
gcloud compute ssh <ชื่อเครื่อง> --zone <zone> --command 'sudo mkdir -p /opt/rakakoom && sudo tar -xzf /tmp/rakakoom.tgz -C /opt/rakakoom'
```
(หรือใช้ปุ่ม SSH ในหน้าเว็บ → Upload file แล้วแตกไฟล์ด้วยคำสั่ง `tar` บรรทัดสุดท้าย)

## 5. ติดตั้ง
```bash
sudo bash /opt/rakakoom/deploy/setup.sh
```
ครั้งแรกสคริปต์จะสร้าง swap 2 GB ติดตั้งโปรแกรม แล้วสร้าง `/etc/rakakoom.env` ให้ แก้ด้วย `sudo nano /etc/rakakoom.env`:
```
FEED_URLS="<ลิงก์ฟีดไฟล์ 1>,<ลิงก์ฟีดไฟล์ 2>"
LINE_CHANNEL_ACCESS_TOKEN="..."
ADMIN_LINE_USER_ID="U..."
HEALTHCHECK_URL="https://hc-ping.com/<uuid ของ check เก็บราคา>"
BACKUP_BUCKET="gs://<ชื่อ bucket>"
BACKUP_KEEP=2
BACKUP_HEALTHCHECK_URL="https://hc-ping.com/<uuid ของ check สำรองข้อมูล>"
```
- ต้องใส่ LINE และ healthchecks ให้ครบ ไม่อย่างนั้นระบบเก็บราคาจะไม่ยอมเริ่ม (กันการทำงานแบบไม่มีใครรู้เวลาพัง)
- ใน healthchecks.io: check เก็บราคา รอบ 1 วัน ผ่อนผัน 8 ชั่วโมง; check สำรองข้อมูล รอบ 1 วัน ผ่อนผัน 10 ชั่วโมง
- แล้วรัน `setup.sh` อีกรอบ ไฟล์ env เป็นความลับ (สิทธิ์ 600) ห้ามคัดลอกไปที่อื่น

## 6. ทดสอบ (ทำครบทุกข้อ ตามลำดับนี้)
1. **การแจ้งเตือนเมื่อล้ม** (ทำก่อน เพราะถ้าวันนั้นเก็บสำเร็จแล้ว รอบทดสอบจะถูกข้าม): แก้ `FEED_URLS="https://example.invalid/x"` ชั่วคราว → `sudo systemctl start rakakoom-collect.service` → แม่หมอต้องได้ LINE "ล้มเหลว" และ healthchecks ขึ้น fail → คืนค่าเดิม
2. **การแจ้งเตือนเมื่อโปรแกรมตาย:** `sudo systemctl start rakakoom-failure@test.service` → ต้องได้ LINE "หยุดทำงานผิดปกติ"
3. **เก็บราคาจริง** (ต้องเป็นหลัง 10:00 เวลาไทย):
   ```bash
   sudo systemctl start rakakoom-collect.service   # อาจใช้หลายชั่วโมงบน e2-micro
   journalctl -u rakakoom-collect -n 5
   sudo -u rakakoom psql rakakoom -c "select feed_date, status, rows_read, rows_kept, last_modified, finished_at - started_at as took from feed_runs order by id desc limit 3"
   ```
   ต้องเห็น `"status":"success"` และ `rows_read` ประมาณ 2,000,000
4. **ฟีดส่ง Last-Modified ไหม:** ดูคอลัมน์ `last_modified` จากข้อ 3 ถ้าเป็น `[null, null]` ระบบจะพึ่งได้แค่การไม่รันก่อน 10:00 — จดไว้ในข้อ 7
5. **สำรองข้อมูล:** `sudo systemctl start rakakoom-backup.service` → `gcloud storage ls -l gs://<bucket>` ต้องเห็น `rakakoom-<วันที่>.dump` แล้วลองกู้:
   ```bash
   gcloud storage cp gs://<bucket>/rakakoom-<วันที่>.dump /tmp/check.dump
   sudo -u postgres createdb -O rakakoom restore_check
   sudo -u rakakoom pg_restore -d restore_check /tmp/check.dump
   sudo -u rakakoom psql restore_check -c "select count(*) from price_changes"
   sudo -u postgres dropdb restore_check; rm /tmp/check.dump
   ```
   จำนวนต้องเท่ากับฐานข้อมูลจริง
6. healthchecks.io ต้องแสดง success จากทั้งสอง check
7. `systemctl list-timers 'rakakoom-*'` ต้องเห็นทั้งสอง timer
8. หลังใช้ 2–3 วัน: เปิดหน้า Billing ต้องเป็น 0 บาท

## 7. ผลจากรอบจริงครั้งแรก (กรอกหลังติดตั้ง)
- เวลาที่ใช้ต่อรอบ: _
- ฟีดส่ง Last-Modified หรือไม่: _
- ขนาดฐานข้อมูล (`select pg_size_pretty(pg_database_size('rakakoom'))`): _
- ขนาดไฟล์สำรอง: _
- พื้นที่ดิสก์ที่เหลือ (`df -h /`): _ → คาดว่าพอประมาณ _ วัน
