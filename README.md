# mcbot

Bot Minecraft untuk login otomatis, mengikuti owner, mengumpulkan material, dan membangun struktur dari file `.litematic` / `.schem` / `.nbt`.

Dibuat untuk server Java offline-mode (AuthMe dan sejenisnya). Bot berjalan di terminal dan dikendalikan lewat perintah teks.

## Kebutuhan

- Node.js 22 atau lebih baru
- Akun Minecraft yang boleh dipakai di server tujuan
- Server Java (tidak perlu dijalankan di komputer ini)

## Instalasi

```bash
cd mcbot
npm install
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "server": { "host": "play.contoh.com", "port": 25565, "version": "1.21.11" },
  "bot": { "username": "BuilderBot", "auth": "offline" },
  "auth": {
    "enabled": true,
    "password": "password-akun-bot",
    "registerCommand": "/register {password} {password}",
    "loginCommand": "/login {password}"
  },
  "physics": { "paperCollisionFix": true },
  "owner": { "username": "NamaKamu", "autoFollow": true }
}
```

- `server.version`: isi `"1.21.11"` untuk Paper 1.21.11. Bisa juga `null` agar dideteksi otomatis.
- `physics.paperCollisionFix` memperbaiki bug collision Paper 1.21.11 yang membuat bot menempel di pinggir block. Biarkan `true` untuk server tersebut.
- `owner.stuckTimeoutMs`, `owner.maxStuckRetries`, dan `owner.unstickJump` mengatur pemulihan otomatis saat follow macet.
- `auth.password` hanya disimpan di `config.json` yang sudah masuk `.gitignore`. Jangan commit file itu.
- `owner.username` adalah username Anda, bukan username bot.
- Kalau server memakai format register/login lain, ubah `registerCommand` / `loginCommand`. Placeholder `{password}` akan diganti otomatis.
- `owner.autoFollow: true` membuat bot mendekat saat owner terlihat, atau saat owner mengirim koordinat di chat/whisper.

## Menjalankan

```bash
npm start
```

Saat pertama kali dijalankan tanpa `config.json`, bot membuat salinannya dari contoh lalu berhenti agar Anda bisa mengeditnya.

Setelah tersambung dan login, akan muncul prompt:

```
mcbot>
```

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `help` | Daftar perintah |
| `status` | Status koneksi, auth, job, posisi |
| `pos` | Koordinat bot |
| `inv [filter]` | Isi inventory |
| `materials <file> [opsi]` | Hitung kebutuhan material |
| `build <file> [opsi]` | Bangun struktur |
| `gamemode [mode]` | Lihat atau ubah gamemode bot (survival/creative/dll) |
| `gather <item> <count>` | Kumpulkan material |
| `attack <nama player> [--bot <id\|nama>]` | Cari dan bunuh player |
| `come [x y z]` | Datang ke owner / koordinat |
| `follow` | Aktifkan auto-follow |
| `say <teks>` | Kirim chat |
| `register` | Kirim ulang command `/register` ke server |
| `auth` | Coba login ulang |
| `pause` / `resume` | Jeda / lanjut build |
| `stop` | Hentikan job |
| `quit` | Keluar |

Opsi `build`:

- `--at x y z` — titik awal build (default: posisi bot)
- `--creative` — gunakan mode creative (bypass pencarian/mining material)
- `--survival` — paksa mode survival
- `--dry-run` — hanya tampilkan rencana material
- `--no-gather` — jangan menambang/crafting, pakai inventory dan chest saja
- `--force` — tetap build walau material kurang
- `--rotate <90|180|270>` — putar blueprint searah jarum jam (north → east)
- `--mirror <x|z>` — cerminkan blueprint pada sumbu x atau z
- `--bot <id|nama>` — pilih bot tertentu saat menjalankan lebih dari satu bot

Opsi `--rotate`, `--mirror`, dan `--bot` juga berlaku untuk `materials`.

Kalau server di-reset total dan akun bot belum terdaftar lagi, jalankan:

```
mcbot> register
```

Bot akan mengirim ulang command yang ada di `auth.registerCommand`.

Contoh:

```
mcbot> materials rumah.litematic
mcbot> build rumah.litematic --at 100 64 -20
mcbot> build rumah.litematic --no-gather
mcbot> build menara.schem --dry-run
mcbot> build rumah.litematic --rotate 90 --mirror z
mcbot> build rumah.litematic --bot 2
```

## Rencana material tanpa menjalankan bot

```bash
npm run plan -- rumah.litematic
npm run plan -- rumah.schem --json
```

Berguna untuk mengecek jumlah blok, material, dan blok yang tidak didukung sebelum masuk server.

## Cara kerja material

1. Cek inventory bot.
2. Ambil dari chest/barrel di sekitar area build (`gather.chestRadius`). Kalau ada blok di atas chest, bot menggali penghalang yang bisa digali lebih dulu.
3. Kalau inventory hampir penuh, bot menyimpan resource ke storage terdekat. Gear, armor, makanan, bahan bakar, dan material job tidak disimpan.
4. Kalau material tidak cocok dengan biome, bot menanyakan pilihan ke owner sebelum menambang.
5. Craft item turunan (plank, stick, stairs, slab, door, dsb.), termasuk fallback resep langsung saat planner utama gagal.
6. Smelt item seperti stone, smooth stone, glass, brick, dan stone bricks. Bahan bakar yang sudah ada di furnace dipakai lebih dulu.
7. Menambang blok sumber di sekitar bot (`gather.mineRadius`) untuk material umum.
8. Kalau masih kurang, build berhenti kecuali `--force`.

Yang tidak otomatis ditambang: material langka/berbahaya seperti diamond, netherite, obsidian, sponge, dan blok yang butuh enchant/silk touch. Siapkan lewat chest atau inventory.

## File blueprint

Lihat [blueprints/README.md](blueprints/README.md). Letakkan file di folder `blueprints/`, lalu panggil namanya saja.

Format yang didukung:

| Ekstensi | Sumber | Catatan |
| --- | --- | --- |
| `.litematic` | Litematica | Beberapa region digabung otomatis |
| `.schem` / `.schematic` | WorldEdit / Sponge / MCEdit | |
| `.nbt` | Structure block Minecraft (“Save Structure”) | |

Semua format menerima `--rotate` dan `--mirror`, jadi satu file bisa dipakai untuk beberapa arah tanpa duplikat.

## Bot macet di pinggir block (Paper 1.21.11)

Paper 1.21.11 memakai hitbox server yang sedikit lebih lebar daripada hitbox client Mineflayer. Saat bot menempel tepat di pinggir block, lompatan bisa ditolak server dan bot terlihat “glued” ke block.

Bot sudah menerapkan kompensasi ukuran hitbox secara otomatis bila `physics.paperCollisionFix` bernilai `true`. Nilai default:

```json
"physics": {
  "paperCollisionFix": true,
  "playerHalfWidth": 0.30001,
  "playerHeight": 1.80001
}
```

Jika Paper memperbaiki bug collision-nya dan bot justru sulit melewati celah sempit, matikan dengan `"paperCollisionFix": false`.

Saat follow macet, bot akan berhenti sebentar, memberi dorongan lompat/mundur, lalu menghitung ulang rute. Atur lewat:

```json
"owner": {
  "stuckTimeoutMs": 4000,
  "maxStuckRetries": 2,
  "stuckCooldownMs": 10000,
  "unstickJump": true
}
```

Aktifkan `"logging": { "debug": true }` untuk melihat log `path_reset`, alasan gagal, dan posisi saat pemulihan.

## Tower otomatis saat follow

Saat owner berada di tebing atau tempat yang lebih tinggi, bot bisa memasang tower untuk mengejar. Kalau block tower tidak cukup, bot berhenti sementara, mencari `grass_block` atau `dirt` terdekat, menambangnya, lalu menghitung ulang rute dan melanjutkan tower.

```json
"owner": {
  "allowTower": true,
  "towerBlocks": ["dirt", "grass_block", "cobblestone", "oak_planks", "scaffolding"],
  "towerPlaceCost": 40,
  "towerGather": {
    "enabled": true,
    "item": "dirt",
    "preferredBlocks": ["grass_block", "dirt"],
    "radius": 32,
    "protectRadius": 6,
    "reserve": 8,
    "minGap": 2,
    "maxPerAttempt": 32,
    "maxAttempts": 3,
    "cooldownMs": 30000,
    "timeoutMs": 120000,
    "allowHandMining": true
  }
}
```

- Urutan `towerBlocks` menentukan prioritas block yang dipakai untuk tower.
- `grass_block` dan `dirt` adalah sumber utama. Tanpa enchant silk touch, `grass_block` akan menjadi `dirt` saat ditambang.
- Bot memakai `dirt` dari inventory, chest, atau hasil tambang. Kalau shovel tidak tersedia, bot tetap menggali dengan tangan.
- `protectRadius` mencegah bot menambang block di sekitar posisi owner.
- Bot tidak menambang block tepat di bawah kakinya supaya tidak jatuh.
- Kalau block tetap tidak ditemukan setelah `maxAttempts`, bot berhenti sementara selama `cooldownMs` lalu mencoba lagi.
- Kalau pencarian block tower gagal total, bot tidak diam: ia melepas rute lama dan tetap mengikuti owner sebisanya (rute biasa). Pencarian block tower berikutnya ditunda `retryCooldownMs` (default `180000` = 3 menit) supaya bot tidak berulang kali berhenti menambang.
- Config lama tetap kompatibel. Kalau bagian `owner.allowTower` atau `owner.towerGather` belum ada, bot memakai nilai default di atas.

## Menambang dan towering

Saat job `gather`/`mine`, bot memakai movements khusus tambang sehingga ia boleh menumpuk 1×1 memakai block hasil tambang sendiri (`cobblestone`, `cobbled_deepslate`, `stone`, `deepslate`, `tuff`, `dirt`, dan sejenisnya) untuk menjangkau block yang lebih tinggi. Ini mencegah bot diam dengan alasan tidak ada block untuk tower saat menambang.

- `owner.allowTower: false` tetap mematikan towering, termasuk saat menambang.
- Kalau block benar-benar tidak terjangkau (pathfinder `NoPath` dua kali), bot menghentikan pencarian block lain untuk job itu, membersihkan goal lama, dan lanjut ke tugas berikutnya dengan warning `Blok tambang tidak terjangkau (perlu menumpuk/naik)`.

## Berenang saat follow

Bot tidak bergantung pada pathfinder untuk menyeberangi air. Saat masuk air, bot mengambil alih kontrol, terus menahan `jump` agar tidak tenggelam, lalu berenang ke arah owner. Kalau menabrak tepian, bot mencoba strafe kiri/kanan sambil tetap melompat.

```json
"owner": {
  "swim": {
    "enabled": true,
    "liquidCost": 12,
    "updateMs": 250,
    "timeoutMs": 120000,
    "shoreStrafeAfterMs": 2000,
    "strafeMs": 800,
    "approachFromShore": true,
    "approachScanDistance": 16,
    "approachTimeoutMs": 4000
  }
},
"safety": {
  "preventDrowning": true
}
```

- `liquidCost` membuat pathfinder lebih memilih jalur air daripada memutar jauh.
- `approachFromShore` membuat bot mencoba berjalan masuk air saat pathfinder melaporkan `noPath`.
- `timeoutMs` hanya menghentikan steering. Anti-tenggelam tetap aktif sampai bot keluar air.
- `preventDrowning` harus tetap `true` agar bot mengapung walaupun `swim.enabled` dimatikan.
- Saat job build/gather berjalan, pathfinder job tetap mengemudi; navigator hanya menjaga bot tetap mengapung.

## Navigasi permukaan

Saat target follow berada di permukaan, bot memberi biaya besar pada langkah yang masuk ke gua/area beratap dan pada turun yang terlalu dalam. Target yang berada di dalam gua tetap memakai navigasi normal.

```json
"owner": {
  "navigation": {
    "surfaceBias": true,
    "verticalThreshold": 4,
    "maxDescent": 2,
    "coverScanHeight": 4
  }
}
```

- `surfaceBias` menyalakan/mematikan bias permukaan.
- `verticalThreshold` menentukan selisih tinggi target agar dianggap target di atas.
- `maxDescent` mencegah bot turun terlalu jauh saat mengejar target permukaan.
- `coverScanHeight` adalah jumlah blok ke atas yang dicek untuk mendeteksi atap.

## Keamanan lava

Bot memantau lava/fire setiap `safety.lava.checkIntervalMs` (default 250 ms). Begitu bot masuk lava, pathfinder dihentikan dan bot dipindahkan ke blok aman terdekat — bukan hanya memberi warning di console.

```json
"safety": {
  "lava": {
    "enabled": true,
    "checkIntervalMs": 250,
    "dangerRadius": 8,
    "escapeTimeoutMs": 2500,
    "cooldownMs": 1500
  }
}
```

Selain penjagaan aktif itu, pathfinder juga diberi aturan tambahan:

- Blok yang berbatasan lava (termasuk diagonal) diberi penalti besar untuk dipijak, baik di Nether maupun di overworld.
- `movements.exclusionAreasBreak` menolak menggali blok yang menempel lava, karena lava bisa langsung mengalir ke lorong. Ini yang membuat bot tidak lagi mati saat menggali `ancient_debris`.
- Saat menambang ancient debris, bot memeriksa kotak 2 blok di sekitar debris dan di depan lorong tambang. Kalau lava terdeteksi, arah lorong diputar 90 derajat; setelah 4 kali putaran (`maxLavaTurns`) bot berhenti dengan alasan `lava-blocked`.

## Makan saat perjalanan

Bot makan otomatis saat food turun. Sebelum makan, bot menghentikan pathfinder sebentar, menunggu proses menggali atau memasang block selesai, lalu melanjutkan perjalanan. Saat berada di air, bot tetap menahan `jump` selama makan.

```json
"safety": {
  "autoEat": true,
  "eatThreshold": 16,
  "criticalFood": 6,
  "eatCheckIntervalMs": 2000,
  "eatRetryMs": 4000,
  "noFoodAction": "stop",
  "pauseMovementWhileEating": true
}
```

- Bot hanya memakai makanan dari inventory.
- Kalau food rendah tetapi tidak ada makanan, bot memberi warning dan tetap berjalan selama food masih di atas `criticalFood`.
- Kalau food mencapai `criticalFood` dan masih tidak ada makanan, bot berhenti, whisper owner, dan menunggu. Job build/gather yang sedang berjalan dihentikan pada batas aman.
- Setelah owner memberi makanan, bot makan lalu melanjutkan perjalanan.
- `follow` dan `resume` mencoba melepas status menunggu makanan bila food sudah aman atau ada makanan di inventory.

## Material lintas biome

Sebelum menambang, bot mendeteksi biome di titik build. Kalau blueprint memakai kayu atau blok khas biome lain dan stok inventory/chest tidak cukup, bot bertanya ke owner. Pertanyaan dikelompokkan per family, misalnya semua varian cherry ditanyakan sekaligus.

```json
"build": {
  "biomeMaterials": {
    "enabled": true,
    "askOwner": true,
    "allowCustomAlternative": true,
    "reminderMs": 30000,
    "pickupRadius": 8,
    "ownerSupplyTimeoutMs": 0
  }
}
```

Pilihan jawaban:

- `1` / `ganti`: ganti seluruh family dengan alternatif yang cocok untuk biome. Contoh: cherry di savanna menjadi acacia.
- `2` / `tetap`: bot tidak menambang/craft material itu. Owner harus drop di dekat bot atau menaruhnya di chest. Bot mengambil drop/chest dan mengingatkan berkala.
- `3` / `stop`: batalkan job build.
- Nama item lain: dipakai sebagai alternatif custom setelah divalidasi.

`ownerSupplyTimeoutMs: 0` berarti bot menunggu tanpa batas sampai item tersedia atau job dihentikan. `gather <item>` dan `--dry-run` tidak memakai dialog ini.

## Combat hostile dan armor otomatis

Bot hanya menyerang mob hostile yang masuk jangkauan. Bot tidak mengejar jauh dan tidak pernah menyerang player sendiri — player hanya diserang lewat perintah manual `attack <nama player>` (lihat bagian berikutnya). Saat ada armor yang lebih baik di inventory, bot memakainya otomatis.

```json
"combat": {
  "enabled": true,
  "autoArmor": true,
  "attackRange": 3.5,
  "detectRadius": 8,
  "maxPursueDistance": 6,
  "attackCooldownMs": 650,
  "defendTimeoutMs": 12000,
  "hunt": {
    "meleeRange": 3.2,
    "bowRange": 24,
    "drawMs": 1000,
    "tickMs": 250,
    "timeoutMs": 180000
  }
}
```

## Menyerang player (`attack`)

`attack <nama player>` adalah perintah manual: bot berhenti dari pekerjaan lain (auto-follow dijeda), mencari player tersebut, lalu membunuhnya.

1. Bot memakai armor terbaik di inventory, lalu senjata dengan damage terbesar (netherite sword > mace > diamond sword > trident > axe, dst).
2. Jarak dekat (≤ `meleeRange`): bot mendekat dengan pathfinder lalu memukul mengikuti cooldown `attackCooldownMs`.
3. Jarak jauh (≤ `bowRange`): bot berhenti, memakai bow, membidik dengan kompensasi jatuhnya panah dan gerakan target, menarik panah selama `drawMs`, lalu melepas. Bot hanya memanah kalau punya panah; kalau panah habis bot mengejar untuk serang jarak dekat.

#### Prediksi arah jatuh panah

Bidikan lama memakai rumus `jatuh = ½ · g · t²` dengan `t = jarak / 3`, lalu membidik titik di atas lawan. Rumus itu **mengabaikan drag** panah, memakai jarak 3D padahal yang menentukan waktu tempuh hanya jarak mendatar, dan membidik `0.8 × tinggi badan` di atas kaki. Hasilnya bidikan meleset **ke atas** saat lawan lebih tinggi / jarak menengah, dan meleset **ke bawah** saat jarak jauh — persis keluhan "kadang terlalu ke atas, kadang terlalu ke bawah".

`src/safety/ballistics.js` sekarang meniru fisika panah server per tick:

```
pos  += velocity
velocity *= 0.99        // drag udara
velocity.y -= 0.05      // gravitasi
```

Dengan kecepatan awal 3 blok/tick (tarikan penuh), modul ini:

1. **Mencari sudut tembak** dengan simulasi + pencarian biner, bukan rumus perkiraan. Sudut dicari dari yang paling datar, jadi bot memilih lintasan rendah yang cepat sampai, bukan melengkung tinggi.
2. **Meluncurkan dari mata bot** (`position.y + 0.9 × tinggi`), sama dengan titik acuan `bot.lookAt` di mineflayer. Dulu dipakai posisi kaki sebagai acuan jarak sehingga sudutnya ikut salah.
3. **Membidik tengah badan lawan** (`aimHeightRatio 0.5`), bukan 0.8 tinggi badan yang mendekati ubun-ubun.
4. **Memimpin target bergerak**: waktu tempuh dari simulasi dipakai untuk memperkirakan posisi lawan saat panah tiba, diulang `aimLeadTicks` kali karena jarak yang berubah juga mengubah waktu tempuh.
5. **Menghitung ulang tepat sebelum melepas**, setelah `drawMs + drawMarginMs`, karena lawan sudah bergerak selama busur ditarik.

Akurasi hasilnya diuji numerik: pada jarak 3–40 blok dan beda tinggi −6 sampai +8 blok, panah mendarat dalam **0.02 blok** dari tengah badan lawan, sedangkan heuristik lama meleset 0.3–0.7 blok.
4. Lebih jauh dari `bowRange`: bot mengejar target (GoalFollow). Kalau pathfinder gagal 3× (`noPath`), job berhenti dengan alasan `unreachable`.
5. Job berhenti sendiri saat target mati, target hilang dari pandangan, `timeoutMs` habis, atau `stop` diketik.

Nilai `combat.hunt` yang bisa diubah:

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `meleeRange` | `3.2` | Jarak (blok) untuk mulai memukul |
| `bowRange` | `24` | Jarak maksimum memakai bow |
| `drawMs` | `1000` | Lama menarik panah sebelum dilepas |
| `drawMarginMs` | `80` | Tambahan waktu tarik agar tarikan benar-benar penuh (panah pelan = jatuh pendek) |
| `aimHeightRatio` | `0.5` | Titik bidik pada badan lawan (0.5 = tengah badan) |
| `aimLeadTicks` | `2` | Berapa kali posisi lawan diperkirakan ulang saat memanah target bergerak |
| `tickMs` | `250` | Jeda antar keputusan menyerang |
| `timeoutMs` | `180000` | Batas waktu satu job attack |
| `retreatEnabled` | `true` | Lari + makan saat darah rendah saat PvP |
| `retreatHealth` | `10` | Darah (dari 20) yang memicu lari |
| `retreatResumeHealth` | `16` | Darah yang harus tercapai sebelum menyerang lagi |
| `retreatDistance` | `12` | Jarak yang dianggap cukup jauh dari target |
| `retreatTickMs` | `200` | Interval pembaruan arah lari |
| `retreatFleeTimeoutMs` | `15000` | Batas waktu lari sebelum kembali menyerang |
| `retreatZigzagDeg` | `35` | Besar belokan kiri/kanan saat lari |
| `retreatZigzagMs` | `400` | Interval ganti arah belokan |

Nilai `combat.shield` untuk memakai shield saat PvP:

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `enabled` | `true` | Pasang shield di off-hand dan pakai untuk memblok saat PvP |
| `blockRange` | `4.5` | Jarak (blok) lawan yang membuat shield otomatis diangkat |
| `predictMs` | `400` | Lama shield tetap terangkat setelah melihat ayunan lawan |
| `approachWindow` | `2.5` | Toleransi jarak ekstra untuk lawan yang bergerak mendekat |
| `refreshMs` | `900` | Interval mengirim ulang state block supaya tidak diam-diam hilang |
| `face` | `true` | Hadapkan bot ke lawan supaya shield memblok dari depan |

Nilai `combat.hunt` untuk critical hit:

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `critEnabled` | `true` | Lompat lalu pukul saat jatuh untuk critical hit |
| `critTickMs` | `20` | Interval pemeriksaan ketinggian/kecepatan saat melompat |
| `critRiseTimeoutMs` | `250` | Batas waktu menunggu bot terangkat |
| `critFallTimeoutMs` | `500` | Batas waktu menunggu bot mulai jatuh |
| `shieldBreakEnabled` | `true` | Pakai kapak kalau lawan memblok dengan shield |
| `shieldBreakPunishMs` | `5000` | Lama shield lawan cooldown setelah kena kapak |
| `shieldBreakWindowMs` | `1500` | Jendela pemeriksaan darah untuk menilai pukulan diblok |

### Retreat dan heal saat PvP

Kalau darah bot turun sampai `retreatHealth` (default 10), bot berhenti menyerang lalu **lari menjauh dari target sambil makan**. Tidak ada lagi pencarian "tempat aman" lewat pathfinder — bot cukup memakai kontrol gerak (`forward` + `sprint`), jadi tidak mungkin gagal dengan `Path was stopped before it could be completed`. Arah lari selalu menjauh dari target, tetapi berganti-ganti kiri/kanan setiap `retreatZigzagMs` sebesar `retreatZigzagDeg`, sehingga bot tidak berlari lurus dan serangan lawan lebih sering meleset. Sebelum berbelok, bot memeriksa blok di depan: lava, api, kaktus, atau dinding akan membuatnya memilih arah belok lain (0°, ±45°, ±90°, ±135°, 180°). Saat tidak bisa maju (menabrak), bot melompat.

Makan berjalan **bersamaan** dengan lari: begitu food di bawah 20 (atau apel emas tersedia, yang tetap bisa dimakan saat makanan penuh), bot memilih makanan terbaik dari inventory dan memakannya tanpa menghentikan lari. Satu hal penting: **sprint dimatikan selama mengunyah** — sprint membatalkan makan di Java, dan itulah yang dulu membuat `bot.consume()` selalu timeout (`Promise timed out.`) sehingga bot sekarat tanpa pernah sembuh. Selama makan bot tetap berjalan menjauh dan tetap zigzag, hanya tidak ngebut, lalu sprint menyala lagi begitu makanan habis. Kalau konsumsi tetap gagal (mis. terputus serangan), bot mencoba ulang sekali lagi; kalau jumlah makanan sudah berkurang atau darah sudah naik, makan dianggap berhasil walau paket konfirmasi server telat. Setelah darah mencapai `retreatResumeHealth` (default 16) bot langsung kembali menyerang dengan senjata terbaik. Kalau tidak ada makanan sama sekali, bot tetap lari sampai `retreatFleeTimeoutMs` habis dan memberi warning. Selama lari shield diturunkan karena memblok memperlambat gerak.

### Shield dan prediksi serangan saat PvP

### Critical hit saat PvP

Setiap kali memukul, bot melompat lalu menahan pukulan sampai **badannya sedang turun** (`velocity.y < 0`, tidak menyentuh tanah). Itu syarat critical hit di Minecraft, jadi damage tiap pukulan naik sekitar 50%. Bot tidak mencoba crit saat di air/lava, di tangga, atau saat sprint — di kondisi itu crit tidak sah, jadi bot memukul biasa tanpa membuang waktu. Kalau lompatan gagal (langit-langit rendah, terhalang blok) atau lawan kabur dari jangkauan, bot langsung memukul normal dalam tick yang sama, jadi tidak ada pukulan yang hilang. Jumlah crit dilaporkan di akhir job: `Target X mati (12 pukulan, 9 kritikal, 0 panah, 14.2s)`.

Bot memasang shield di off-hand begitu job `attack` mulai, lalu mengangkatnya saat lawan berada dalam `blockRange`. Bot juga memprediksi serangan: ayunan tangan lawan (`entitySwingArm`) dan gerakan lawan yang mendekat cepat sudah cukup untuk mengangkat shield sebelum damage masuk. ### Strategi mematahkan shield lawan

Kalau lawan memegang shield dan memblok, bot tidak membuang pukulan ke dinding: ia beralih ke **kapak**. Satu pukulan kapak mematikan shield lawan selama 5 detik (mekanik vanilla), dan begitu shield mati bot langsung kembali ke **pedang** untuk memakai jendela 5 detik itu sepenuhnya. Alurnya:

1. Bot memukul dengan pedang. Kalau darah lawan **tidak turun** padahal pukulan mendarat (atau metadata lawan menunjukkan tangan aktif dengan shield), pukulan itu dianggap tertahan.
2. Bot memasang kapak terbaik di inventory lalu memukul. Pukulan itu memang masih ditahan shield, tapi shield lawan langsung cooldown 5 detik.
3. Selama `shieldBreakPunishMs` bot memakai pedang lagi; setelah itu, kalau lawan mengangkat shield lagi, siklus diulang dari langkah 1.

Bot tidak pernah menebak: kalau data darah lawan tidak tersedia atau pukulan terakhir sudah terlalu lama (`shieldBreakWindowMs`), ia tetap memakai pedang. Kalau di inventory tidak ada kapak sama sekali, bot tetap menyerang dengan senjata terbaiknya dan mencatat peringatan sekali saja, bukan berhenti. Jumlah shield yang berhasil dipatahkan masuk ke log akhir job.

Shield **tetap terangkat walaupun bot sedang memukul** — di Java pukulan tangan utama tidak memutus block off-hand, dan inilah yang membuat block sebelumnya sering bocor. Shield hanya diturunkan untuk aksi yang benar-benar butuh tangan kanan: makan dan memanah. Supaya tidak pernah "diam-diam mati", bot mengirim ulang state block setiap `refreshMs` dan mengangkatnya lagi setiap kali menerima `entityHurt`. Bot juga menghadapkan badannya ke lawan saat mengangkat shield, karena block hanya berlaku untuk serangan dari depan. Saat lari karena darah rendah shield diturunkan dulu supaya larinya cepat, lalu otomatis aktif lagi begitu bot kembali menyerang. Kalau inventory tidak punya shield, bot menyerang seperti biasa tanpa error.

Saat mode multi-bot, `attack <nama player>` tanpa `--bot` mengirim semua bot yang online dan idle; `attack <nama player> --bot 2` hanya bot itu. CombatManager otomatis dimatikan selama job attack agar tidak menukar senjata di tengah tarikan panah, lalu dinyalakan lagi setelah job selesai.

## Storage otomatis

Saat slot kosong tinggal `minFreeSlots` atau kurang, bot mencari chest/barrel/shulker box dan menyimpan item yang bukan gear, armor, makanan, bahan bakar, atau material job.

```json
"storage": {
  "enabled": true,
  "radius": 32,
  "minFreeSlots": 2,
  "clearObstructions": true,
  "containers": ["chest", "trapped_chest", "barrel", "shulker_box"]
}
```

Kalau tidak ada storage, bot memberi warning dan menghentikan job. Penghalang di atas container ikut dibersihkan bila `clearObstructions` aktif; atur tinggi pembersihan lewat `gather.clearHeight`.

## Prioritas cave saat mining

Di overworld bot mencari cave/lorong terdekat lebih dulu sebelum menggali lubang baru — cocok untuk base bawah tanah yang sudah punya jalan ke cave. Kalau blok ore terdekat sudah lebih dekat dari `caveMinOreDistance`, bot langsung menambang tanpa berjalan ke cave.

```json
"gather": {
  "preferCaves": true,
  "caveRadius": 48,
  "caveTravelTimeoutMs": 60000,
  "caveMinOreDistance": 16
}
```

- `preferCaves` menyalakan pencarian cave. Tidak berlaku di Nether.
- `caveRadius` adalah radius pencarian cave dari posisi bot.
- `caveMinOreDistance` menentukan kapan bot dianggap "sudah dekat ore" sehingga tidak perlu pindah ke cave.
- Kandidat cave diurutkan dari yang terdekat; kalau tidak terjangkau bot mencoba kandidat berikutnya (maksimal 3), lalu kembali menambang seperti biasa.

### Tambang cepat dan tidak meninggalkan ore

Bot menghancurkan ore yang sudah dalam jangkauan tangan (≤ 4,3 blok) langsung dengan `dig` plus tool terbaik, tanpa menunggu pathfinding. Blok yang lebih jauh baru didekati sekali dengan `GoalNear`, lalu digali. Urutan target selalu mendahulukan ore di sekitar bot, jadi ore yang sudah terlihat tidak ditinggalkan untuk mencari blok lain.

```json
"gather": {
  "digTimeoutMs": 15000,
  "walkTimeoutMs": 8000,
  "maxStalled": 5
}
```

- `digTimeoutMs` batas waktu satu blok digali (turun dari 45 detik agar bot cepat pindah kalau macet).
- `walkTimeoutMs` batas waktu berjalan ke blok yang belum terjangkau — kalau gagal, blok itu dilewati, bukan diulang terus.
- `maxStalled` jumlah kegagalan beruntun pada blok yang sudah terjangkau sebelum job berhenti dengan alasan `unreachable`.

## Menebang kayu: satu bot satu pohon, dari atas ke bawah

Gather `*_log`, `*_wood`, dan `*_stem` tidak memakai penambangan blok acak. Bot mengelompokkan blok kayu menjadi pohon (blok yang bersentuhan dianggap satu pohon), lalu:

- Setiap bot mengklaim **satu pohon** lewat registry klaim yang dipakai bersama semua sesi bot dalam satu proses. Bot lain melewati pohon yang sudah diklaim, jadi swarm berpencar, bukan menyerbu satu pohon.
- Dalam satu pohon, blok **tertinggi yang sudah terjangkau ditebang lebih dulu**, lalu turun ke bawah. Ini yang diminta untuk pohon besar seperti dark oak: tebang dari atas, bukan menggali bagian bawah dan meninggalkan puncak yang tidak terjangkau.
- Kalau puncak masih di atas jangkauan (4,3 blok dari mata), bot menumpuk 1 blok (dirt/cobblestone atau log hasil tebangan sendiri) untuk mendekat, sampai `maxClimbs` kali.
- Kalau sisa blok ada di samping (cabang), bot mencari posisi berdiri yang benar-benar kosong di sekitar blok lalu berjalan ke sana. Posisi berdiri ini juga dipakai saat menambang, sehingga trunk 2×2 dark oak tidak lagi gagal dengan `unreachable`.
- Kalau satu pohon sudah habis, bot pindah ke pohon terdekat berikutnya yang belum diklaim, dan radius pencarian melebar otomatis (64 → 96 → 128 blok) kalau pohon di sekitar sudah habis.

```json
"gather": {
  "tree": {
    "enabled": true,
    "scanRadius": 64,
    "maxScanRadius": 128,
    "minTreeSize": 4,
    "maxEmptyTrees": 3,
    "maxTreesPerJob": 64,
    "maxClimbs": 6,
    "maxFailures": 6,
    "waitMs": 2000,
    "climb": true
  }
}
```

- `enabled: false` mengembalikan perilaku lama (menambang blok kayu terdekat satu per satu).
- `minTreeSize` membuat bot mendahulukan pohon utuh (≥ 4 log); pohon kecil tetap diambil kalau tidak ada yang besar.
- `maxEmptyTrees` jumlah pohon gagal beruntun sebelum job berhenti dengan alasan `unreachable`; `maxFailures` jumlah blok gagal dalam satu pohon.
- `waitMs` jeda tunggu kalau semua pohon di sekitar sedang diklaim bot lain.
- `climb: false` melarang bot menumpuk blok untuk mencapai puncak (bot hanya menebang yang terjangkau).
- Log progres muncul per pohon: `Bot <nama> menebang pohon <id> (n blok, tinggi h, jarak d blok)` dan `Pohon <id>: n log ditebang, progres x/y`.

Kalau perintah dijalankan lewat swarm, sisa kuota yang belum terpenuhi dibagi lagi ke bot yang idle sampai `swarm.gatherRounds` putaran (default 2), jadi kekurangan tidak langsung dilaporkan sebagai "selesai sebagian" tanpa usaha kedua.

```json
"swarm": {
  "gatherRounds": 2
}
```

## Membersihkan penghalang chest

```json
"gather": {
  "clearChestObstructions": true,
  "clearHeight": 3
}
```

Bot hanya menggali blok yang `diggable`. Cairan atau blok yang tidak bisa digali akan menghasilkan warning dan container dilewati.

## Gamemode dan Mode Creative

Bot mendukung penggantian gamemode baik lewat perintah terminal maupun otomatis saat memulai job build:

```text
mcbot> gamemode
mcbot> gamemode creative
mcbot> gamemode survival
```

Konfigurasi `gamemode`:

```json
"gamemode": {
  "enabled": true,
  "command": "/gamemode {mode}",
  "buildMode": "creative",
  "restoreAfterBuild": true,
  "switchTimeoutMs": 3000
}
```

- `command`: template perintah ganti gamemode (mendukung placeholder `{mode}` dan `{username}`).
- `buildMode`: jika disetel `"creative"` (default), bot akan mencoba berganti ke mode creative saat menjalankan `build`.
- `restoreAfterBuild`: jika `true`, bot akan otomatis dikembalikan ke mode sebelumnya (misalnya survival) setelah build selesai.
- **Bypass Material**: Saat mode creative aktif, bot memunculkan blok yang dibutuhkan secara instan ke inventory menggunakan packet native creative Mineflayer (`bot.creative.setInventorySlot`), sehingga proses penambangan, crafting, smelting, pencarian chest, dan dialog biome otomatis dilewati.
- **Fallback Otomatis**: Jika server menolak perintah gamemode (misalnya bot tidak memiliki izin OP), bot akan mencatat warning dan otomatis melanjutkan build dalam mode survival biasa.

## Batasan

- Orientasi mengikuti file. Gunakan `--rotate` / `--mirror` bila perlu arah lain; arah blok menghadap (tangga, torch dinding, sign) ikut diputar tetapi tidak dijamin sama persis untuk blok ber-properti khusus.
- Scaffold yang dipasang tidak dibongkar otomatis kecuali `build.removeScaffolds` diubah ke `true` (default `false`).
- Multi-bot: satu perintah `build` dijalankan oleh satu bot (`--bot <id|nama>`, default bot primary). Build paralel oleh beberapa bot belum didukung.
- Farmland dan dirt path tidak dibuat otomatis; sediakan lewat chest bila diperlukan.
- Entity, isi chest, teks sign, dan data tile tidak ikut dibangun.
- Build bisa gagal di area protected, claim, atau saat anti-cheat server ketat.
- Scaffold otomatis hanya untuk target yang masih terjangkau setelah naik beberapa blok; struktur menggantung tinggi bisa butuh penanganan manual.
- Tower follow membutuhkan block yang bisa dipasang. Kalau tidak ada dirt/grass, cobblestone, planks, atau scaffolding di sekitar, bot mencatat warning sekali lalu tetap mengikuti owner dengan rute biasa (tanpa tower) selama 3 menit sebelum mencoba mencari block lagi.
- Bot tidak memilih block berdasarkan klaim atau aturan server. Gunakan `owner.towerGather.protectRadius` dan pastikan menambang area tersebut diizinkan.
- Mode renang hanya untuk permukaan air. Owner yang berada di bawah air atau di balik tebing tinggi belum dijamin.
- Kalau makanan habis, bot akan berhenti dan menunggu owner. Bot tidak mencari chest atau berburu makanan otomatis.
- Combat tidak mengejar mob di luar jangkauan dan tidak menjamin menang melawan mob kuat seperti warden atau wither.
- Storage hanya memakai container yang terdeteksi di sekitar bot. Ender chest tidak dipakai otomatis.
- Material lintas biome bergantung pada jawaban owner. Job akan menunggu selama owner belum menjawab atau menyediakan material pada pilihan `tetap`.
- Bot tidak menyimpan password di log. Tetap jaga `config.json` dan gunakan akun khusus bot.

## Testing

```bash
npm test
```

Tes mencakup parser `.litematic`/`.schem`/`.nbt`, rotasi dan mirror blueprint, kebutuhan material, parser koordinat, auth, konfigurasi physics, deteksi follow macet, tower supply, movement tower, water navigator, food manager, urutan build, navigasi tangga dan permukaan, dialog owner, material biome, combat, attack player (pemilihan senjata, bow jarak jauh, pengejaran, lari zigzag + makan saat darah rendah), keamanan lava (LavaGuard, lorong ancient debris), prioritas cave saat mining, tambang langsung blok dalam jangkauan (tanpa antre pathfinding), critical hit (memukul saat jatuh), shield PvP (prediksi ayunan lawan, block tetap saat memukul), strategi kapak untuk mematahkan shield lawan lalu menyerang dengan pedang, container, dan storage. Tes tidak memerlukan server Minecraft.
