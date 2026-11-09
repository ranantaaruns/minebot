# Minebot

Bot Minecraft Java berbasis [Mineflayer](https://github.com/PrismarineJS/mineflayer) untuk membantu membangun struktur, mengumpulkan material, mengikuti owner, dan menjalankan PvP. Bot dikendalikan melalui terminal, dapat berjalan sendiri atau sebagai **swarm hingga 50 bot** dalam satu server.

Proyek ini terutama ditujukan untuk server Java **offline-mode** yang memakai plugin login seperti AuthMe. Target pengembangan saat ini adalah **Minecraft 1.21.11**; sebagian fitur, khususnya spear dan Wind Burst, bergantung pada versi server.

## Fitur utama

- **Login otomatis** — register/login AuthMe, reconnect, anti-AFK, dan deteksi status spawn.
- **Mengikuti owner** — auto-follow, menerima koordinat dari chat/whisper, berenang, memanjat tangga, dan membuat tower sederhana saat diperlukan.
- **Membangun blueprint** — mendukung `.litematic`, `.schem`, `.schematic`, dan `.nbt`, termasuk rotasi, mirror, survival, dan creative.
- **Gather material** — mengambil dari inventory/chest, crafting, smelting, mining, menyimpan kelebihan item, dan membagi pekerjaan antar-bot.
- **Menebang pohon dengan aman** — satu bot satu pohon, menebang dari atas ke bawah, mengambil drop, menanam ulang sapling, serta melewati tiang kayu yang tampak seperti bagian bangunan.
- **PvP normal** — sword/axe/shield, critical hit, orbit mengelilingi lawan, bow dengan prediksi balistik, dodge panah, dan retreat sambil makan.
- **Combo mace** — wind charge dilempar ke bawah untuk meluncur, smash saat jatuh, dukungan rantai Wind Burst, dan water-bucket clutch.
- **Charge spear** — memakai elytra dan firework, menjauh untuk run-up, menyerang dengan kecepatan relatif tinggi, serta menghindari halangan di jalur terbang.
- **Lava bucket opsional** — menaruh lava untuk membakar lawan lalu mengambil sumbernya kembali.
- **Sinkronisasi spawn kasur** — saat owner tidur, bot ikut tidur agar memperoleh spawn di area kasur owner.
- **Pelacakan player** — mencatat koordinat entity yang memang dikirim server, lengkap dengan penanda saat posisi hanya berupa prediksi.

Dokumentasi opsi dan perilaku teknis yang lebih lengkap tersedia di [Panduan Lengkap](docs/PANDUAN-LENGKAP.md).

## Kebutuhan

- [Node.js 22 atau lebih baru](https://nodejs.org/).
- Server Minecraft Java yang mengizinkan bot masuk.
- Akun/username khusus bot; untuk AuthMe, siapkan password bot.
- Izin build, mining, PvP, atau gamemode yang sesuai di server.

## Instalasi

```bash
git clone https://github.com/ranantaaruns/minebot.git
cd minebot
npm install
cp config.example.json config.json
```

Di Windows Command Prompt, gunakan `copy config.example.json config.json` jika `cp` tidak tersedia.

Edit `config.json`:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 25565,
    "version": "1.21.11"
  },
  "bot": {
    "username": "BuilderBot",
    "auth": "offline",
    "count": 1
  },
  "owner": {
    "username": "NamaKamu",
    "autoFollow": true,
    "syncBedSpawn": true
  },
  "auth": {
    "enabled": true,
    "password": "GANTI_DENGAN_PASSWORD_BOT",
    "registerCommand": "/register {password} {password}",
    "loginCommand": "/login {password}"
  }
}
```

Penjelasan singkat:

| Opsi | Fungsi |
| --- | --- |
| `server.host` / `server.port` | Alamat server tujuan |
| `server.version` | Versi Minecraft; gunakan `null` untuk deteksi otomatis |
| `bot.username` | Username bot pertama |
| `bot.count` | Jumlah bot saat launcher non-interaktif |
| `owner.username` | Username akun kamu, **bukan** username bot |
| `auth.enabled` | Mengaktifkan register/login otomatis |
| `auth.password` | Password AuthMe bot |
| `owner.autoFollow` | Bot mengikuti owner secara otomatis |
| `owner.syncBedSpawn` | Bot ikut set spawn saat owner tidur di kasur |

`config.json` sudah tercantum di `.gitignore`. **Jangan pernah commit password atau config lokal kamu.** File `config.example.json` hanya berisi contoh.

## Menjalankan bot

```bash
npm start
```

Launcher akan menanyakan jumlah bot dan nickname-nya. Setelah bot terhubung, gunakan prompt berikut:

```text
mcbot>
```

Ketik `help` untuk melihat daftar perintah langsung dari program.

## Cara menggunakannya

### Perintah dasar

| Perintah | Fungsi |
| --- | --- |
| `status` | Melihat koneksi, auth, job, dan posisi |
| `pos` | Menampilkan koordinat bot |
| `inv [filter]` | Melihat inventory |
| `come` | Memanggil bot ke owner |
| `come <x> <y> <z>` | Mengirim bot ke koordinat |
| `follow` | Mengaktifkan auto-follow owner |
| `say <teks>` | Mengirim pesan ke chat server |
| `register` | Mengirim ulang perintah register |
| `auth` | Mencoba login ulang |
| `pause` / `resume` | Menjeda/melanjutkan build |
| `stop` | Menghentikan job aktif |
| `quit` | Keluar dan memutuskan bot |

### Gather material

```text
mcbot> gather oak_log 64
mcbot> gather ancient_debris 4
mcbot> gather stone 128
```

Bot akan memeriksa inventory dan chest terdekat, lalu crafting/smelting/mining sesuai kebutuhan. Untuk kayu, bot memprioritaskan pohon di sekitarnya dan mengambil drop setelah menebang.

Filter pohon asli dapat dimatikan melalui `gather.tree.naturalOnly: false`, tetapi gunakan dengan hati-hati karena bot bisa menganggap log pada bangunan sebagai pohon.

### Membangun blueprint

Letakkan file di folder `blueprints/`, lalu jalankan:

```text
mcbot> materials rumah.litematic
mcbot> build rumah.litematic --at 100 64 -20
mcbot> build menara.schem --dry-run
mcbot> build rumah.litematic --rotate 90 --mirror z
mcbot> build rumah.litematic --no-gather
mcbot> build rumah.litematic --bot 2
```

Opsi penting:

| Opsi | Fungsi |
| --- | --- |
| `--at <x> <y> <z>` | Menentukan titik awal build |
| `--creative` | Memakai creative dan melewati pencarian material |
| `--survival` | Memaksa survival |
| `--dry-run` | Hanya menghitung rencana/material |
| `--no-gather` | Tidak mining/crafting; hanya inventory dan chest |
| `--force` | Tetap membangun walaupun material kurang |
| `--rotate <90\|180\|270>` | Memutar blueprint searah jarum jam |
| `--mirror <x\|z>` | Mencerminkan blueprint |
| `--bot <id\|nama>` | Memilih bot tertentu dalam swarm |

Menghitung material tanpa masuk server:

```bash
npm run plan -- blueprints/rumah.litematic
npm run plan -- blueprints/rumah.schem --json
```

### PvP dan pemilihan senjata

Pilih mode terlebih dahulu, lalu berikan target secara eksplisit:

```text
mcbot> weapon normal
mcbot> attack NamaPlayer

mcbot> weapon mace
mcbot> attack NamaPlayer

mcbot> weapon spear
mcbot> attack NamaPlayer
```

| Mode | Perlengkapan wajib | Perilaku |
| --- | --- | --- |
| `normal` | Sword/axe; shield disarankan | Melee, orbit, crit, shield break, bow bila tersedia |
| `mace` | Mace dan wind charge | Vertical launch dan smash; Wind Burst menghemat wind charge |
| `spear` | Spear asli, elytra, firework rocket | Takeoff, run-up untuk kecepatan, charge, dan obstacle avoidance |

Tambahan:

- `weapon` tanpa argumen menampilkan mode dan kesiapan perlengkapan.
- `combat on` / `combat off` mengaktifkan atau mematikan engine combo udara.
- Mode khusus hanya digunakan untuk `attack <player>`; bot tidak memilih target PvP sendiri.
- Pada swarm, pergantian mode dibatalkan untuk semua bot jika ada satu bot yang perlengkapannya tidak lengkap.
- Lava bucket dipakai otomatis di mode normal jika tersedia dan masih memungkinkan diambil kembali.

### Spawn di kasur owner

Biarkan `owner.syncBedSpawn: true`. Saat owner tidur, bot akan mencari kasur tersebut, mendekat, lalu ikut tidur.

Vanilla hanya mengizinkan **satu pemain per kasur**. Jika kasur owner sedang terisi, bot mencari kasur kosong terdekat dalam `owner.bedSearchRadius` (default 6 blok). Bot tetap tunduk pada aturan tidur vanilla seperti waktu malam/thunderstorm dan jarak aman dari monster.

### Pelacakan player

```text
mcbot> track
mcbot> track where NamaPlayer
mcbot> track export hasil.json
mcbot> track off
```

Fitur ini hanya memakai paket entity yang diterima bot. Bot tidak dapat mengetahui posisi player offline atau player yang tidak dikirim server.

## Menjalankan swarm

Saat launcher interaktif, masukkan jumlah bot sampai 50. Untuk konfigurasi non-interaktif, gunakan `bot.count` atau daftar username eksplisit:

```json
{
  "bot": {
    "username": "BuilderBot",
    "auth": "offline",
    "count": 10
  },
  "swarm": {
    "maxBots": 50,
    "staggerDelayMs": 400,
    "gatherRounds": 2
  }
}
```

Atau tentukan nama satu per satu:

```json
{
  "bots": [
    { "username": "BuilderBot" },
    { "username": "BuilderBot_2" },
    { "username": "BuilderBot_3" }
  ]
}
```

Pastikan server menaikkan batas `max-players` dan mempunyai CPU/RAM yang cukup. Batas 50 bot adalah batas aplikasi, bukan jaminan bahwa server atau komputer kamu sanggup menjalankannya dengan lancar.

## Kelebihan

- Satu program mencakup build, gather, navigasi, PvP, dan multi-bot.
- Banyak keputusan berjalan per `physicsTick`, sehingga urutan combo tidak hanya bergantung pada timer.
- Pembagian kerja swarm mengurangi bot yang berebut pohon atau target yang sama.
- Fitur keselamatan mencakup auto-eat, retreat, dodge, perlindungan lava, dan pengambilan kembali bucket.
- Gathering kayu melindungi chest serta menghindari log yang terlihat sebagai bagian bangunan.
- Config lokal dan password tidak ikut masuk Git secara default.
- Memiliki suite tes otomatis yang dapat dijalankan tanpa server Minecraft.

## Kekurangan dan batasan

- **Bukan jaminan menang atau anti-cheat bypass.** Lag, proteksi wilayah, plugin server, terrain sempit, dan anti-cheat dapat menggagalkan combo atau build.
- Perubahan terbaru diverifikasi melalui tes unit/fake bot; perilaku fisik seperti ketinggian wind charge dan kecepatan elytra tetap perlu diuji pada server nyata.
- Dirancang untuk Minecraft Java, terutama 1.21.11. Fitur yang memakai item/enchant baru tidak tersedia pada versi lama.
- Login otomatis terutama dibuat untuk offline-mode/AuthMe, bukan pengganti login akun Microsoft online-mode.
- Build paralel satu blueprint oleh banyak bot belum didukung; gunakan `--bot` untuk memilih satu pelaksana.
- Entity, isi chest, teks sign, dan seluruh data tile blueprint tidak selalu ikut dibangun.
- Bot tidak dapat tidur di kasur yang sudah terisi; ia akan mencari kasur kosong di dekatnya.
- Filter pohon dapat melewati pohon tanpa daun atau struktur yang ambigu. Ini disengaja untuk mengurangi kerusakan bangunan.
- Pelacakan player hanya bekerja dalam jangkauan entity-tracking server; data lama/prediksi bukan koordinat pasti.
- Jika makanan habis atau akses terhalang proteksi server, bot dapat berhenti dan menunggu bantuan owner.
- Swarm besar dapat membebani CPU, RAM, koneksi, dan server.

## Menjalankan tes

```bash
npm test
```

Tes tidak memerlukan server Minecraft dan mencakup blueprint, config, navigasi, gather, pohon, inventory, combat, mace, spear, swarm, dan pelacakan player.

## Struktur proyek

```text
src/
  blueprint/       Parser blueprint
  build/           Perencanaan dan eksekusi build
  combat/          Engine mace, spear, loadout, dan FSM
  materials/       Gather, crafting, smelting, dan penebangan
  navigation/      Air, tangga, dan tower
  safety/          PvP normal, dodge, makan, lava, dan shield
  swarm/           Sesi dan koordinasi multi-bot
  cli.js           Perintah terminal
  config.js        Default dan validasi konfigurasi
blueprints/        Tempat file blueprint lokal
scripts/           Utilitas command-line
test/              Tes otomatis
docs/              Dokumentasi teknis lanjutan
```

Gunakan bot hanya pada server yang mengizinkannya dan ikuti aturan server tersebut.
