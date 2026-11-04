# Blueprints

Taruh file bangunan di folder ini, lalu jalankan dari root project:

```bash
npm run plan -- rumah.litematic
npm start
mcbot> build rumah.litematic
```

Format yang didukung:

- `.litematic` dari Litematica
- `.schem` dari WorldEdit (Sponge schematic)
- `.schematic` dari WorldEdit lama (MCEdit)
- `.nbt` selama isinya schematic yang dikenali

Catatan:

- Ukuran dibatasi `build.maxVolume` (default 200.000 blok volume). Naikkan di `config.json` kalau perlu.
- Orientasi mengikuti file apa adanya. Rotasi/mirror belum didukung.
- Entity, isi chest, teks sign, dan data tile lain tidak ikut dibangun.
- Blok yang tidak bisa didapat sebagai item (air, water, lava, bedrock, spawner, crop, dsb.) dilewati otomatis.
- Pintu, tempat tidur, tall plant, dan blok dua bagian lain ditangani sebagian; bagian atas dibuat otomatis saat bagian bawah dipasang.
- Untuk bahan bangunan, taruh chest berisi material di dekat area build. Bot memakai isi chest sebelum menambang.
- Build dimulai dari posisi kaki bot (default `build.anchor: "bot"`). Gunakan `--at x y z` untuk menentukan titik awal.
