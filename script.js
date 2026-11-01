/* =====================================================
   TestCase Genie — script.js
   Logika utama: deteksi kata kunci, generasi test case,
   filter tab, salin Markdown, ekspor CSV, toast, reset
   ===================================================== */

'use strict';

/* ── 1. REFERENSI ELEMEN DOM ── */
const elUserStory    = document.getElementById('userStory');
const elFeatureType  = document.getElementById('featureType');
const elBtnGenerate  = document.getElementById('btnGenerate');
const elBtnReset     = document.getElementById('btnReset');
const elEmptyState   = document.getElementById('emptyState');
const elResultCard   = document.getElementById('resultCard');
const elTableBody    = document.getElementById('testTableBody');
const elTotalBadge   = document.getElementById('totalBadge');
const elBtnCopyMd    = document.getElementById('btnCopyMd');
const elBtnExportCsv = document.getElementById('btnExportCsv');
const elToast        = document.getElementById('toast');

/* Tab filter elements */
const tabButtons = document.querySelectorAll('.tab-btn');
const cntAll     = document.getElementById('cnt-all');
const cntPos     = document.getElementById('cnt-pos');
const cntNeg     = document.getElementById('cnt-neg');
const cntEdge    = document.getElementById('cnt-edge');

/* ── 2. STATE ── */
let allTestCases  = [];   // Semua test case yang sudah dibuat
let activeFilter  = 'all'; // Filter tab aktif
let toastTimer    = null;  // Timer toast notification

/* ── 3a. EKSTRAKTOR BATASAN DARI INPUT ──
   Membaca angka dari pola seperti:
     "minimal 8 karakter"  → { passMin: 8 }
     "terkunci setelah 5 kali gagal" → { lockAfter: 5 }
     "maksimal 100 karakter" → { passMax: 100 }
   Mengembalikan objek dengan nilai default jika pola tidak ditemukan.
*/
function parseConstraints(text) {
  const lower = text.toLowerCase();

  /* Helper: ambil angka pertama yang muncul setelah pola regex.
     Iterasi semua capture group karena beberapa pola punya dua alternatif. */
  function extractNum(regex, fallback) {
    const m = lower.match(regex);
    if (!m) return fallback;
    // Cari capture group pertama yang berisi nilai (bukan undefined)
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) return parseInt(m[i], 10);
    }
    return fallback;
  }

  return {
    // Panjang minimum kata sandi / password
    passMin: extractNum(
      /(?:minimal?|minimum|paling\s+(?:sedikit|pendek)|at\s+least)\s+(\d+)\s*(?:karakter|char)/,
      8
    ),
    // Panjang maksimum kata sandi / password
    passMax: extractNum(
      /(?:maksimal?|maximum|paling\s+(?:banyak|panjang)|at\s+most)\s+(\d+)\s*(?:karakter|char)/,
      128
    ),
    // Jumlah percobaan gagal sebelum akun dikunci
    lockAfter: extractNum(
      /(?:terkunci?|dikunci|lock(?:ed)?|block(?:ed)?)\s+(?:setelah|after|jika|bila|kalau)\s+(\d+)|(\d+)\s+kali\s+(?:gagal|percobaan\s+gagal|salah)/,
      5
    ),
    // Batas maksimum generik (untuk kata kunci "batasan")
    limitMax: extractNum(
      /(?:batas|maksimal?|limit)\s+(?:maksimum\s+)?(\d+)/,
      null
    ),
    // Batas minimum generik (untuk kata kunci "batasan")
    limitMin: extractNum(
      /(?:batas|minimal?|limit)\s+(?:minimum\s+)?(\d+)/,
      null
    )
  };
}

/* ── 3. KAMUS KATA KUNCI ──
   Setiap entri adalah sebuah fungsi pabrik (factory) yang menerima
   objek batasan (constraints) dan mengembalikan array test case.
   Ini memungkinkan skenario dan hasil yang diharapkan menggunakan
   angka nyata dari input pengguna, bukan nilai tetap.
*/
const KEYWORD_FACTORIES = {
  /* === EMAIL === */
  email(c) {
    return [
      {
        scenario: 'Login dengan format email tidak valid',
        prerequisite: 'Halaman login terbuka, pengguna belum masuk',
        steps: ['Buka halaman login', 'Masukkan email dengan format salah (contoh: abc@)', 'Klik tombol Masuk'],
        expected: 'Sistem menampilkan pesan error "Format email tidak valid"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Login dengan email yang tidak terdaftar',
        prerequisite: 'Halaman login terbuka, pengguna belum masuk',
        steps: ['Buka halaman login', 'Masukkan email yang belum terdaftar', 'Masukkan kata sandi yang benar', 'Klik tombol Masuk'],
        expected: 'Sistem menampilkan pesan "Email atau kata sandi salah"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Login dengan kolom email dikosongkan',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Biarkan kolom email kosong', 'Klik tombol Masuk'],
        expected: 'Sistem menampilkan validasi "Email tidak boleh kosong"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Login dengan email yang sangat panjang (lebih dari 254 karakter)',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan email sepanjang lebih dari 254 karakter', 'Klik tombol Masuk'],
        expected: 'Sistem menolak input atau memotong email sesuai standar RFC 5321',
        type: 'Edge', priority: 'Sedang'
      },
      {
        scenario: 'Login dengan email yang mengandung karakter unicode/spesial',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan email dengan karakter unicode (contoh: üser@domain.com)', 'Klik tombol Masuk'],
        expected: 'Sistem menangani input dengan benar dan menampilkan pesan yang sesuai',
        type: 'Edge', priority: 'Sedang'
      },
      {
        scenario: 'Login berhasil dengan email valid dan kata sandi benar',
        prerequisite: 'Akun sudah terdaftar, halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan email terdaftar yang valid', 'Masukkan kata sandi yang benar', 'Klik tombol Masuk'],
        expected: 'Pengguna berhasil masuk dan diarahkan ke halaman utama',
        type: 'Positif', priority: 'Tinggi'
      },
      /* Keamanan: SQL Injection & XSS pada kolom email */
      {
        scenario: 'Keamanan: SQL Injection pada kolom email',
        prerequisite: 'Halaman login terbuka',
        steps: ["Buka halaman login", "Masukkan payload SQL Injection di kolom email: ' OR '1'='1'--", 'Klik tombol Masuk'],
        expected: 'Sistem tidak terpengaruh; input disanitasi dan menampilkan pesan "Email tidak valid"',
        type: 'Edge', priority: 'Tinggi'
      },
      {
        scenario: 'Keamanan: XSS (Cross-Site Scripting) pada kolom email',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan payload XSS di kolom email: <script>alert("xss")</script>', 'Klik tombol Masuk'],
        expected: 'Sistem menyaring input; skrip tidak dieksekusi dan pesan error ditampilkan',
        type: 'Edge', priority: 'Tinggi'
      }
    ];
  },

  /* === KATA SANDI === */
  'kata sandi'(c) {
    const min      = c.passMin;
    const max      = c.passMax;
    const lockN    = c.lockAfter;
    const below    = min - 1;  // Nilai boundary: 1 di bawah minimum
    const above    = min + 1;  // Nilai boundary: 1 di atas minimum

    return [
      /* Negatif: di bawah minimum */
      {
        scenario: `Login dengan kata sandi kurang dari ${min} karakter (${below} karakter)`,
        prerequisite: 'Halaman login terbuka, pengguna terdaftar',
        steps: [
          'Buka halaman login',
          'Masukkan email valid',
          `Masukkan kata sandi sepanjang ${below} karakter`,
          'Klik tombol Masuk'
        ],
        expected: `Sistem menampilkan pesan "Kata sandi minimal ${min} karakter"`,
        type: 'Negatif', priority: 'Tinggi'
      },
      /* Edge: tepat pada batas minimum */
      {
        scenario: `Batas bawah: kata sandi tepat ${min} karakter (nilai minimum)`,
        prerequisite: 'Halaman login / registrasi terbuka',
        steps: [
          'Buka halaman login / registrasi',
          `Masukkan kata sandi tepat ${min} karakter`,
          'Klik tombol Masuk / Daftar'
        ],
        expected: `Sistem menerima kata sandi tepat ${min} karakter tanpa error`,
        type: 'Edge', priority: 'Tinggi'
      },
      /* Edge: satu di atas minimum */
      {
        scenario: `Batas atas minimum: kata sandi ${above} karakter (minimum + 1)`,
        prerequisite: 'Halaman login / registrasi terbuka',
        steps: [
          'Buka halaman login / registrasi',
          `Masukkan kata sandi sepanjang ${above} karakter`,
          'Klik tombol Masuk / Daftar'
        ],
        expected: `Sistem menerima kata sandi ${above} karakter dan memprosesnya dengan benar`,
        type: 'Edge', priority: 'Sedang'
      },
      /* Negatif: percobaan gagal → kunci akun */
      {
        scenario: `Login dengan kata sandi salah sebanyak ${lockN} kali berturut-turut`,
        prerequisite: 'Akun terdaftar, halaman login terbuka',
        steps: [
          'Buka halaman login',
          'Masukkan email valid',
          `Masukkan kata sandi yang salah sebanyak ${lockN} kali berturut-turut`,
          'Klik Masuk pada setiap percobaan'
        ],
        expected: `Sistem mengunci akun setelah ${lockN} kali percobaan gagal dan menampilkan pesan peringatan`,
        type: 'Negatif', priority: 'Tinggi'
      },
      /* Negatif: kolom kosong */
      {
        scenario: 'Login dengan kolom kata sandi dikosongkan',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan email valid', 'Biarkan kolom kata sandi kosong', 'Klik tombol Masuk'],
        expected: 'Sistem menampilkan validasi "Kata sandi tidak boleh kosong"',
        type: 'Negatif', priority: 'Tinggi'
      },
      /* Edge: sangat panjang */
      {
        scenario: `Login dengan kata sandi yang sangat panjang (lebih dari ${max} karakter)`,
        prerequisite: 'Halaman login terbuka',
        steps: [
          'Buka halaman login',
          'Masukkan email valid',
          `Masukkan kata sandi sepanjang lebih dari ${max} karakter`,
          'Klik tombol Masuk'
        ],
        expected: 'Sistem menangani input dengan benar tanpa crash atau error tidak terduga',
        type: 'Edge', priority: 'Sedang'
      },
      /* Positif: karakter disensor */
      {
        scenario: 'Input kata sandi disensor (karakter tersembunyi)',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan teks di kolom kata sandi', 'Amati tampilan karakter di kolom'],
        expected: 'Karakter kata sandi ditampilkan sebagai tanda bintang atau titik',
        type: 'Positif', priority: 'Tinggi'
      },
      /* Keamanan: SQL Injection pada kolom kata sandi */
      {
        scenario: 'Keamanan: SQL Injection pada kolom kata sandi',
        prerequisite: 'Halaman login terbuka',
        steps: ["Buka halaman login", 'Masukkan email valid', "Masukkan payload SQL Injection di kolom kata sandi: ' OR '1'='1", 'Klik tombol Masuk'],
        expected: 'Sistem tidak terpengaruh; input disanitasi dan login ditolak',
        type: 'Edge', priority: 'Tinggi'
      },
      /* Keamanan: XSS pada kolom kata sandi */
      {
        scenario: 'Keamanan: XSS (Cross-Site Scripting) pada kolom kata sandi',
        prerequisite: 'Halaman login terbuka',
        steps: ['Buka halaman login', 'Masukkan email valid', 'Masukkan payload XSS di kolom kata sandi: <script>alert("xss")</script>', 'Klik tombol Masuk'],
        expected: 'Sistem menyaring input; skrip tidak dieksekusi dan login ditolak',
        type: 'Edge', priority: 'Tinggi'
      }
    ];
  },

  /* === PASSWORD (kata bahasa Inggris) === */
  password(c) {
    const min   = c.passMin;
    const below = min - 1;
    const above = min + 1;

    return [
      {
        scenario: 'Input password dengan karakter spesial (!@#$%)',
        prerequisite: 'Formulir dengan kolom password terbuka',
        steps: ['Buka formulir', 'Masukkan password berisi karakter spesial (!@#$%^&*)', 'Kirim formulir'],
        expected: 'Sistem menerima password dengan karakter spesial tanpa error',
        type: 'Positif', priority: 'Sedang'
      },
      {
        scenario: 'Password tidak memenuhi aturan kompleksitas',
        prerequisite: 'Formulir registrasi / ubah password terbuka',
        steps: ['Buka formulir', 'Masukkan password sederhana tanpa huruf besar atau angka', 'Klik Simpan'],
        expected: 'Sistem menampilkan pesan aturan kompleksitas password yang tidak terpenuhi',
        type: 'Negatif', priority: 'Tinggi'
      },
      /* Boundary value: tepat min, min-1, min+1 */
      {
        scenario: `Boundary value: password tepat ${min} karakter (batas minimum)`,
        prerequisite: 'Formulir registrasi / ubah password terbuka',
        steps: [`Masukkan password tepat ${min} karakter`, 'Klik Simpan'],
        expected: `Sistem menerima password ${min} karakter tanpa error`,
        type: 'Edge', priority: 'Tinggi'
      },
      {
        scenario: `Boundary value: password ${below} karakter (1 di bawah minimum)`,
        prerequisite: 'Formulir registrasi / ubah password terbuka',
        steps: [`Masukkan password ${below} karakter`, 'Klik Simpan'],
        expected: `Sistem menampilkan error "Password minimal ${min} karakter"`,
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: `Boundary value: password ${above} karakter (1 di atas minimum)`,
        prerequisite: 'Formulir registrasi / ubah password terbuka',
        steps: [`Masukkan password ${above} karakter`, 'Klik Simpan'],
        expected: `Sistem menerima password ${above} karakter tanpa error`,
        type: 'Edge', priority: 'Sedang'
      },
      /* Keamanan */
      {
        scenario: 'Keamanan: SQL Injection pada kolom password',
        prerequisite: 'Formulir dengan kolom password terbuka',
        steps: ["Masukkan payload SQL Injection: ' OR '1'='1'-- di kolom password", 'Kirim formulir'],
        expected: 'Sistem tidak terpengaruh; input disanitasi dan formulir ditolak',
        type: 'Edge', priority: 'Tinggi'
      },
      {
        scenario: 'Keamanan: XSS pada kolom password',
        prerequisite: 'Formulir dengan kolom password terbuka',
        steps: ['Masukkan payload XSS: <script>alert("xss")</script> di kolom password', 'Kirim formulir'],
        expected: 'Sistem menyaring input; skrip tidak dieksekusi dan formulir ditolak',
        type: 'Edge', priority: 'Tinggi'
      }
    ];
  },

  /* === WAJIB / HARUS DILENGKAPI — hanya relevan untuk tipe form === */
  wajib(c, featureType) {
    if (featureType === 'login') return []; // Tidak relevan untuk login
    return [
      {
        scenario: 'Mengirim formulir dengan semua kolom wajib dikosongkan',
        prerequisite: 'Formulir terbuka, belum ada data yang diisi',
        steps: ['Buka halaman formulir', 'Biarkan semua kolom kosong', 'Klik tombol Kirim'],
        expected: 'Sistem menampilkan validasi error di setiap kolom wajib',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Mengirim formulir dengan sebagian kolom wajib dikosongkan',
        prerequisite: 'Formulir terbuka, beberapa kolom telah diisi',
        steps: ['Isi sebagian kolom wajib', 'Kosongkan satu kolom wajib', 'Klik tombol Kirim'],
        expected: 'Sistem menampilkan validasi hanya pada kolom wajib yang kosong',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Validasi kolom wajib berjalan secara real-time (on-blur)',
        prerequisite: 'Formulir terbuka',
        steps: ['Klik kolom wajib', 'Biarkan kosong', 'Klik area di luar kolom (blur)'],
        expected: 'Pesan validasi muncul segera setelah kolom kehilangan fokus',
        type: 'Positif', priority: 'Sedang'
      }
    ];
  },

  required(c, featureType) {
    if (featureType === 'login') return []; // Tidak relevan untuk login
    return [
      {
        scenario: 'Pengiriman formulir dengan field required kosong',
        prerequisite: 'Halaman formulir terbuka',
        steps: ['Buka formulir', 'Kosongkan field yang required', 'Klik Submit / Kirim'],
        expected: 'Browser atau sistem menampilkan validasi "Field ini wajib diisi"',
        type: 'Negatif', priority: 'Tinggi'
      }
    ];
  },

  /* === BATASAN / LIMIT — gunakan angka dari input jika tersedia === */
  batasan(c) {
    const hasMax = c.limitMax !== null;
    const hasMin = c.limitMin !== null;
    const maxLabel = hasMax ? `${c.limitMax} karakter` : 'batas maksimum';
    const minLabel = hasMin ? `${c.limitMin} karakter` : 'batas minimum';
    const overMax  = hasMax ? c.limitMax + 1 : null;
    const atMax    = hasMax ? c.limitMax      : null;

    return [
      {
        scenario: hasMax
          ? `Input melebihi batas maksimum (${overMax} karakter, batas: ${c.limitMax})`
          : 'Input melebihi batas maksimum karakter yang ditentukan',
        prerequisite: 'Formulir dengan batasan karakter terbuka',
        steps: [
          'Buka formulir',
          hasMax ? `Masukkan teks sepanjang ${overMax} karakter (melebihi batas ${c.limitMax})` : 'Masukkan teks melebihi batas maksimum',
          'Klik Kirim'
        ],
        expected: hasMax
          ? `Sistem menolak input atau memotong teks pada ${c.limitMax} karakter`
          : 'Sistem menolak input atau memotong teks sesuai batas yang ditetapkan',
        type: 'Edge', priority: 'Sedang'
      },
      {
        scenario: hasMax
          ? `Input tepat pada batas maksimum (${atMax} karakter)`
          : 'Input tepat pada batas maksimum karakter (boundary value)',
        prerequisite: 'Formulir dengan batasan karakter terbuka',
        steps: [
          'Buka formulir',
          hasMax ? `Masukkan teks tepat ${atMax} karakter` : 'Masukkan teks tepat sebanyak batas maksimum karakter',
          'Klik Kirim'
        ],
        expected: 'Sistem menerima input dan memprosesnya dengan benar',
        type: 'Edge', priority: 'Sedang'
      },
      {
        scenario: hasMin
          ? `Input di bawah batas minimum (kurang dari ${minLabel})`
          : 'Input di bawah batas minimum yang ditentukan',
        prerequisite: 'Formulir dengan validasi minimum terbuka',
        steps: [
          'Buka formulir',
          hasMin ? `Masukkan nilai atau teks kurang dari ${c.limitMin} karakter` : 'Masukkan nilai atau teks di bawah batas minimum',
          'Klik Kirim'
        ],
        expected: hasMin
          ? `Sistem menampilkan pesan error "Nilai tidak boleh kurang dari ${c.limitMin}"`
          : 'Sistem menampilkan pesan error tentang batas minimum',
        type: 'Negatif', priority: 'Tinggi'
      }
    ];
  },

  /* === UNGGAH / UPLOAD === */
  unggah(c) {
    return [
      {
        scenario: 'Unggah file dengan format yang tidak didukung',
        prerequisite: 'Halaman unggah file terbuka',
        steps: ['Buka halaman unggah', 'Pilih file berformat tidak didukung (contoh: .exe)', 'Klik Unggah'],
        expected: 'Sistem menampilkan pesan error "Format file tidak didukung"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Unggah file yang melebihi ukuran maksimum',
        prerequisite: 'Halaman unggah file terbuka',
        steps: ['Buka halaman unggah', 'Pilih file berukuran lebih besar dari batas', 'Klik Unggah'],
        expected: 'Sistem menolak unggahan dan menampilkan pesan "Ukuran file melebihi batas maksimum"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Unggah file berhasil dengan format dan ukuran sesuai',
        prerequisite: 'Halaman unggah file terbuka',
        steps: ['Buka halaman unggah', 'Pilih file berformat dan berukuran sesuai', 'Klik Unggah'],
        expected: 'File berhasil diunggah dan konfirmasi ditampilkan kepada pengguna',
        type: 'Positif', priority: 'Tinggi'
      },
      {
        scenario: 'Unggah file kosong (0 byte)',
        prerequisite: 'Halaman unggah file terbuka',
        steps: ['Buka halaman unggah', 'Pilih file berukuran 0 byte', 'Klik Unggah'],
        expected: 'Sistem menolak file kosong dan menampilkan pesan yang sesuai',
        type: 'Edge', priority: 'Sedang'
      }
    ];
  },

  upload(c) {
    return [
      {
        scenario: 'Upload multiple files sekaligus',
        prerequisite: 'Halaman upload mendukung multi-file',
        steps: ['Buka halaman upload', 'Pilih lebih dari satu file sekaligus', 'Klik Upload'],
        expected: 'Semua file valid terunggah, file tidak valid ditolak dengan pesan error',
        type: 'Edge', priority: 'Sedang'
      }
    ];
  },

  /* === PEMBAYARAN / PAYMENT === */
  pembayaran(c) {
    return [
      {
        scenario: 'Pembayaran dengan nomor kartu kredit tidak valid',
        prerequisite: 'Halaman pembayaran terbuka, keranjang belanja tidak kosong',
        steps: ['Buka halaman pembayaran', 'Masukkan nomor kartu kredit yang tidak valid', 'Klik Bayar'],
        expected: 'Sistem menampilkan pesan error "Nomor kartu tidak valid"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Pembayaran dengan kartu yang sudah kadaluarsa',
        prerequisite: 'Halaman pembayaran terbuka',
        steps: ['Buka halaman pembayaran', 'Masukkan kartu dengan tanggal kadaluarsa yang sudah lewat', 'Klik Bayar'],
        expected: 'Sistem menolak transaksi dan menampilkan "Kartu sudah kadaluarsa"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Pembayaran berhasil dengan data kartu yang valid',
        prerequisite: 'Kartu kredit aktif, halaman pembayaran terbuka',
        steps: ['Buka halaman pembayaran', 'Masukkan nomor kartu valid', 'Masukkan tanggal dan CVV yang benar', 'Klik Bayar'],
        expected: 'Transaksi berhasil, konfirmasi pembayaran ditampilkan dan email dikirim',
        type: 'Positif', priority: 'Tinggi'
      },
      {
        scenario: 'Pembayaran dengan saldo tidak mencukupi',
        prerequisite: 'Halaman pembayaran terbuka, kartu aktif',
        steps: ['Buka halaman pembayaran', 'Gunakan kartu dengan saldo tidak mencukupi', 'Klik Bayar'],
        expected: 'Sistem menampilkan "Saldo tidak mencukupi untuk menyelesaikan transaksi"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Pembayaran ganda akibat klik tombol Bayar lebih dari sekali',
        prerequisite: 'Halaman pembayaran terbuka',
        steps: ['Buka halaman pembayaran', 'Isi data pembayaran', 'Klik tombol Bayar dua kali atau lebih secara cepat'],
        expected: 'Sistem hanya memproses satu transaksi; tombol dinonaktifkan setelah klik pertama',
        type: 'Edge', priority: 'Tinggi'
      }
    ];
  },

  /* === PENCARIAN / SEARCH === */
  pencarian(c) {
    return [
      {
        scenario: 'Pencarian dengan kata kunci valid yang ada di sistem',
        prerequisite: 'Halaman pencarian terbuka, data sudah tersedia',
        steps: ['Buka halaman pencarian', 'Masukkan kata kunci yang ada', 'Klik Cari'],
        expected: 'Sistem menampilkan daftar hasil yang relevan dengan kata kunci',
        type: 'Positif', priority: 'Tinggi'
      },
      {
        scenario: 'Pencarian dengan kata kunci yang tidak ditemukan',
        prerequisite: 'Halaman pencarian terbuka',
        steps: ['Buka halaman pencarian', 'Masukkan kata kunci yang tidak ada di sistem', 'Klik Cari'],
        expected: 'Sistem menampilkan pesan "Tidak ada hasil yang ditemukan"',
        type: 'Negatif', priority: 'Sedang'
      },
      {
        scenario: 'Pencarian dengan kolom kosong',
        prerequisite: 'Halaman pencarian terbuka',
        steps: ['Buka halaman pencarian', 'Biarkan kolom pencarian kosong', 'Klik Cari'],
        expected: 'Sistem menampilkan semua data atau pesan "Masukkan kata kunci terlebih dahulu"',
        type: 'Negatif', priority: 'Sedang'
      },
      {
        scenario: 'Pencarian menggunakan karakter SQL injection',
        prerequisite: 'Halaman pencarian terbuka',
        steps: ["Buka halaman pencarian", "Masukkan karakter seperti ' OR '1'='1", 'Klik Cari'],
        expected: 'Sistem tidak terpengaruh oleh injeksi SQL; input disanitasi dengan benar',
        type: 'Edge', priority: 'Tinggi'
      }
    ];
  },

  search(c) {
    return [
      {
        scenario: 'Pencarian dengan kata kunci mengandung karakter spesial',
        prerequisite: 'Halaman pencarian terbuka',
        steps: ['Buka halaman pencarian', 'Masukkan kata kunci dengan karakter spesial (&, %, #)', 'Klik Cari'],
        expected: 'Sistem menangani karakter spesial dengan benar tanpa error',
        type: 'Edge', priority: 'Sedang'
      }
    ];
  },

  /* === NOMOR TELEPON === */
  telepon(c) {
    return [
      {
        scenario: 'Input nomor telepon dengan format tidak valid',
        prerequisite: 'Formulir dengan kolom nomor telepon terbuka',
        steps: ['Buka formulir', 'Masukkan nomor telepon dengan format salah (huruf atau simbol)', 'Klik Kirim'],
        expected: 'Sistem menampilkan pesan "Format nomor telepon tidak valid"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Input nomor telepon dengan panjang tidak sesuai',
        prerequisite: 'Formulir dengan kolom nomor telepon terbuka',
        steps: ['Buka formulir', 'Masukkan nomor telepon terlalu pendek (2 digit)', 'Klik Kirim'],
        expected: 'Sistem menampilkan validasi panjang nomor telepon yang diperlukan',
        type: 'Negatif', priority: 'Sedang'
      }
    ];
  },

  /* === TANGGAL / DATE === */
  tanggal(c) {
    return [
      {
        scenario: 'Input tanggal dengan format tidak valid',
        prerequisite: 'Formulir dengan kolom tanggal terbuka',
        steps: ['Buka formulir', 'Masukkan tanggal dengan format salah (contoh: 32/13/2024)', 'Klik Kirim'],
        expected: 'Sistem menampilkan pesan "Format tanggal tidak valid"',
        type: 'Negatif', priority: 'Tinggi'
      },
      {
        scenario: 'Input tanggal hari ini sebagai nilai batas (boundary)',
        prerequisite: 'Formulir dengan kolom tanggal terbuka',
        steps: ['Buka formulir', 'Masukkan tanggal hari ini', 'Klik Kirim'],
        expected: 'Sistem menerima tanggal hari ini sebagai nilai yang valid',
        type: 'Edge', priority: 'Sedang'
      }
    ];
  },

  /* === CAPTCHA / VERIFIKASI === */
  captcha(c) {
    return [
      {
        scenario: 'Mengirim formulir dengan CAPTCHA salah',
        prerequisite: 'Halaman formulir dengan CAPTCHA terbuka',
        steps: ['Buka formulir', 'Isi semua kolom dengan benar', 'Masukkan kode CAPTCHA yang salah', 'Klik Kirim'],
        expected: 'Sistem menolak pengiriman dan menampilkan "Kode CAPTCHA salah, coba lagi"',
        type: 'Negatif', priority: 'Tinggi'
      }
    ];
  }
};

/* ── 4. TEMPLATE DASAR PER TIPE FITUR ──
   Setiap tipe memiliki test case dasar yang selalu muncul
   sebagai fondasi, terlepas dari kata kunci.
*/
const BASE_TEMPLATES = {
  login: [
    {
      scenario: 'Login berhasil dengan kredensial yang valid',
      prerequisite: 'Pengguna sudah terdaftar, halaman login terbuka',
      steps: ['Buka halaman login', 'Masukkan email dan kata sandi yang benar', 'Klik tombol Masuk'],
      expected: 'Pengguna berhasil masuk dan diarahkan ke halaman dashboard',
      type: 'Positif', priority: 'Tinggi'
    },
    {
      scenario: 'Login dengan semua kolom dikosongkan',
      prerequisite: 'Halaman login terbuka',
      steps: ['Buka halaman login', 'Biarkan semua kolom kosong', 'Klik tombol Masuk'],
      expected: 'Sistem menampilkan pesan validasi pada semua kolom wajib',
      type: 'Negatif', priority: 'Tinggi'
    },
    {
      scenario: 'Halaman login dapat diakses dari berbagai perangkat (responsif)',
      prerequisite: 'Koneksi internet tersedia',
      steps: ['Buka halaman login di desktop', 'Buka halaman login di perangkat mobile', 'Buka halaman login di tablet'],
      expected: 'Halaman login tampil dengan benar dan responsif di semua perangkat',
      type: 'Positif', priority: 'Sedang'
    },
    {
      scenario: 'Sesi otomatis berakhir setelah periode tidak aktif',
      prerequisite: 'Pengguna sudah login',
      steps: ['Login ke sistem', 'Tinggalkan sesi tanpa aktivitas selama periode timeout', 'Coba lakukan tindakan apapun'],
      expected: 'Sesi berakhir otomatis dan pengguna diarahkan kembali ke halaman login',
      type: 'Edge', priority: 'Sedang'
    },
    {
      scenario: 'Menampilkan pesan error yang tepat saat login gagal',
      prerequisite: 'Akun terdaftar, halaman login terbuka',
      steps: ['Masukkan email valid tetapi kata sandi salah', 'Klik Masuk'],
      expected: 'Pesan error ditampilkan tanpa mengungkap informasi sensitif (email/kata sandi mana yang salah)',
      type: 'Negatif', priority: 'Tinggi'
    }
  ],

  form: [
    {
      scenario: 'Pengisian dan pengiriman formulir dengan data valid',
      prerequisite: 'Halaman formulir terbuka, pengguna memiliki data yang valid',
      steps: ['Buka halaman formulir', 'Isi semua kolom dengan data yang valid', 'Klik tombol Kirim'],
      expected: 'Formulir berhasil dikirim dan konfirmasi ditampilkan kepada pengguna',
      type: 'Positif', priority: 'Tinggi'
    },
    {
      scenario: 'Pengiriman formulir dengan semua kolom dikosongkan',
      prerequisite: 'Halaman formulir terbuka',
      steps: ['Buka halaman formulir', 'Biarkan semua kolom kosong', 'Klik tombol Kirim'],
      expected: 'Sistem menampilkan validasi error di setiap kolom yang wajib diisi',
      type: 'Negatif', priority: 'Tinggi'
    },
    {
      scenario: 'Formulir mempertahankan data setelah validasi gagal',
      prerequisite: 'Halaman formulir terbuka',
      steps: ['Isi sebagian kolom formulir', 'Kirim dengan kolom wajib yang masih kosong', 'Amati isi kolom setelah error muncul'],
      expected: 'Data yang sudah diisi tetap ada setelah gagal validasi (tidak direset)',
      type: 'Positif', priority: 'Sedang'
    },
    {
      scenario: 'Pengiriman formulir berulang dengan klik ganda pada tombol Kirim',
      prerequisite: 'Halaman formulir terbuka',
      steps: ['Isi semua kolom dengan data valid', 'Klik tombol Kirim dua kali secara cepat'],
      expected: 'Sistem hanya memproses satu pengiriman; tombol dinonaktifkan setelah klik pertama',
      type: 'Edge', priority: 'Tinggi'
    },
    {
      scenario: 'Input XSS (Cross-Site Scripting) pada kolom formulir',
      prerequisite: 'Halaman formulir terbuka',
      steps: ['Buka formulir', 'Masukkan script berbahaya seperti <script>alert(1)</script>', 'Kirim formulir'],
      expected: 'Sistem menyanitasi input dan tidak menjalankan kode berbahaya',
      type: 'Edge', priority: 'Tinggi'
    },
    {
      scenario: 'Tombol Batal / Reset mengosongkan semua kolom formulir',
      prerequisite: 'Formulir sudah diisi sebagian',
      steps: ['Isi beberapa kolom formulir', 'Klik tombol Batal atau Reset'],
      expected: 'Semua kolom formulir direset ke kondisi awal kosong',
      type: 'Positif', priority: 'Sedang'
    }
  ],

  search: [
    {
      scenario: 'Pencarian berhasil menemukan hasil yang relevan',
      prerequisite: 'Halaman pencarian terbuka, data tersedia di sistem',
      steps: ['Buka halaman pencarian', 'Masukkan kata kunci yang valid', 'Klik tombol Cari atau tekan Enter'],
      expected: 'Daftar hasil relevan ditampilkan sesuai kata kunci',
      type: 'Positif', priority: 'Tinggi'
    },
    {
      scenario: 'Pencarian tidak menemukan hasil',
      prerequisite: 'Halaman pencarian terbuka',
      steps: ['Masukkan kata kunci yang tidak ada di sistem', 'Klik Cari'],
      expected: 'Sistem menampilkan pesan "Tidak ada hasil yang ditemukan untuk kata kunci ini"',
      type: 'Negatif', priority: 'Sedang'
    },
    {
      scenario: 'Pencarian dengan filter atau kategori diterapkan',
      prerequisite: 'Halaman pencarian terbuka, opsi filter tersedia',
      steps: ['Buka halaman pencarian', 'Pilih filter kategori tertentu', 'Masukkan kata kunci', 'Klik Cari'],
      expected: 'Hasil pencarian hanya menampilkan data sesuai filter yang dipilih',
      type: 'Positif', priority: 'Sedang'
    },
    {
      scenario: 'Pencarian dengan kata kunci sangat panjang (lebih dari 500 karakter)',
      prerequisite: 'Halaman pencarian terbuka',
      steps: ['Masukkan kata kunci sepanjang lebih dari 500 karakter', 'Klik Cari'],
      expected: 'Sistem menangani input panjang dengan benar tanpa crash atau error',
      type: 'Edge', priority: 'Sedang'
    },
    {
      scenario: 'Autocomplete/saran pencarian berfungsi dengan benar',
      prerequisite: 'Fitur autocomplete diaktifkan',
      steps: ['Mulai mengetik kata kunci', 'Amati daftar saran yang muncul', 'Pilih salah satu saran'],
      expected: 'Saran muncul setelah minimal 2 karakter; saran yang dipilih mengisi kolom pencarian',
      type: 'Positif', priority: 'Sedang'
    },
    {
      scenario: 'Pencarian menggunakan karakter injeksi SQL',
      prerequisite: 'Halaman pencarian terbuka',
      steps: ["Masukkan karakter ' OR '1'='1-- di kolom pencarian", 'Klik Cari'],
      expected: 'Sistem tidak terpengaruh oleh injeksi SQL; hanya menampilkan "Tidak ada hasil"',
      type: 'Edge', priority: 'Tinggi'
    }
  ],

  payment: [
    {
      scenario: 'Pembayaran berhasil dengan metode pembayaran yang valid',
      prerequisite: 'Keranjang belanja tidak kosong, halaman pembayaran terbuka',
      steps: ['Buka halaman pembayaran', 'Pilih metode pembayaran', 'Masukkan data pembayaran yang valid', 'Klik Bayar'],
      expected: 'Transaksi berhasil, halaman konfirmasi ditampilkan, dan notifikasi dikirim',
      type: 'Positif', priority: 'Tinggi'
    },
    {
      scenario: 'Pembayaran gagal karena jaringan terputus',
      prerequisite: 'Halaman pembayaran terbuka',
      steps: ['Isi data pembayaran', 'Putuskan koneksi internet', 'Klik Bayar'],
      expected: 'Sistem menampilkan pesan error koneksi dan tidak memproses transaksi ganda',
      type: 'Negatif', priority: 'Tinggi'
    },
    {
      scenario: 'Pembayaran dengan jumlah nol atau negatif',
      prerequisite: 'Sistem memungkinkan input jumlah manual',
      steps: ['Buka halaman pembayaran', 'Masukkan jumlah 0 atau angka negatif', 'Klik Bayar'],
      expected: 'Sistem menolak transaksi dan menampilkan validasi jumlah tidak valid',
      type: 'Edge', priority: 'Tinggi'
    },
    {
      scenario: 'Transaksi timeout saat gateway pembayaran lambat',
      prerequisite: 'Halaman pembayaran terbuka, gateway lambat',
      steps: ['Isi data pembayaran', 'Klik Bayar', 'Tunggu melebihi waktu batas timeout'],
      expected: 'Sistem menampilkan pesan timeout dan memberikan opsi untuk mencoba kembali',
      type: 'Edge', priority: 'Tinggi'
    },
    {
      scenario: 'Tampilan ringkasan pesanan sebelum konfirmasi pembayaran',
      prerequisite: 'Keranjang belanja tidak kosong',
      steps: ['Buka halaman pembayaran', 'Periksa ringkasan pesanan yang ditampilkan'],
      expected: 'Ringkasan menampilkan item, harga, pajak, dan total yang benar',
      type: 'Positif', priority: 'Sedang'
    },
    {
      scenario: 'Pengembalian dana (refund) setelah pembayaran berhasil',
      prerequisite: 'Pembayaran berhasil sebelumnya',
      steps: ['Buka riwayat transaksi', 'Pilih transaksi yang ingin direfund', 'Klik Ajukan Pengembalian Dana'],
      expected: 'Permintaan refund diterima dan diproses sesuai kebijakan sistem',
      type: 'Positif', priority: 'Sedang'
    }
  ],

  other: [
    {
      scenario: 'Fitur berfungsi dengan benar dalam kondisi normal',
      prerequisite: 'Pengguna sudah login, semua prasyarat terpenuhi',
      steps: ['Navigasi ke halaman fitur', 'Lakukan tindakan utama sesuai alur pengguna', 'Verifikasi hasilnya'],
      expected: 'Fitur berfungsi sesuai dengan persyaratan yang telah ditentukan',
      type: 'Positif', priority: 'Tinggi'
    },
    {
      scenario: 'Fitur menampilkan pesan error yang sesuai saat terjadi kegagalan',
      prerequisite: 'Kondisi error yang dapat disimulasikan',
      steps: ['Picu kondisi error pada fitur', 'Amati pesan yang ditampilkan'],
      expected: 'Pesan error jelas, informatif, dan tidak mengungkap informasi teknis sensitif',
      type: 'Negatif', priority: 'Tinggi'
    },
    {
      scenario: 'Fitur dapat diakses dan digunakan pada berbagai perangkat',
      prerequisite: 'Perangkat desktop dan mobile tersedia',
      steps: ['Akses fitur di desktop', 'Akses fitur di smartphone', 'Bandingkan tampilan dan fungsi'],
      expected: 'Fitur responsif dan berfungsi dengan benar di semua ukuran layar',
      type: 'Positif', priority: 'Sedang'
    },
    {
      scenario: 'Fitur berjalan dengan benar saat pengguna memiliki hak akses berbeda',
      prerequisite: 'Sistem memiliki level hak akses pengguna',
      steps: ['Login sebagai pengguna biasa', 'Coba akses fitur', 'Login sebagai admin', 'Coba akses fitur yang sama'],
      expected: 'Fitur menampilkan konten atau opsi sesuai level hak akses masing-masing pengguna',
      type: 'Edge', priority: 'Tinggi'
    },
    {
      scenario: 'Performa fitur saat digunakan dengan data dalam jumlah besar',
      prerequisite: 'Database berisi data dalam jumlah besar',
      steps: ['Login ke sistem', 'Akses fitur yang memuat banyak data', 'Ukur waktu respons'],
      expected: 'Waktu respons tidak melebihi 3 detik; tidak ada crash atau timeout',
      type: 'Edge', priority: 'Sedang'
    },
    {
      scenario: 'Input tidak valid ditolak dengan pesan yang tepat',
      prerequisite: 'Halaman fitur terbuka',
      steps: ['Masukkan data yang tidak valid di kolom input', 'Kirim atau proses data'],
      expected: 'Sistem menampilkan pesan validasi yang jelas dan tidak memproses data tidak valid',
      type: 'Negatif', priority: 'Tinggi'
    }
  ]
};

/* ── 5. FUNGSI UTAMA: DETEKSI KATA KUNCI ──
   Memeriksa teks input, mencocokkan dengan kunci di KEYWORD_FACTORIES,
   lalu memanggil factory yang sesuai dengan constraints dan featureType.
   Keyword yang tidak cocok dengan tipe fitur (misal "wajib" saat login)
   akan menghasilkan array kosong dari factory-nya sendiri.
*/
function detectKeywords(text, constraints, featureType) {
  const lower = text.toLowerCase();
  const added = new Set(); // Mencegah factory dipanggil dua kali untuk kunci yang sama
  const extras = [];

  Object.keys(KEYWORD_FACTORIES).forEach(keyword => {
    if (lower.includes(keyword) && !added.has(keyword)) {
      added.add(keyword);
      // Panggil factory dengan constraints dan featureType
      const cases = KEYWORD_FACTORIES[keyword](constraints, featureType);
      extras.push(...cases);
    }
  });

  return extras;
}

/* ── 6. FUNGSI UTAMA: BUAT TEST CASE ──
   1. Urai batasan angka dari teks input (parseConstraints).
   2. Ambil template dasar sesuai tipe fitur.
   3. Tambahkan test case dari kata kunci yang terdeteksi.
   4. Hapus duplikat berdasarkan kesamaan teks skenario.
   5. Beri ID urut TC-001, TC-002, dst.
*/
function generateTestCases(story, featureType) {
  // Langkah 1: Baca batasan angka dari input
  const constraints = parseConstraints(story);

  // Langkah 2: Template dasar — hanya ambil tipe yang sesuai fitur,
  // jangan gunakan template 'form' saat featureType adalah 'login'
  const baseCases = BASE_TEMPLATES[featureType] || BASE_TEMPLATES.other;

  // Langkah 3: Test case dari kata kunci (dengan constraints & featureType)
  const keywordCases = detectKeywords(story, constraints, featureType);

  // Langkah 4: Gabungkan, hapus duplikat skenario (case-insensitive trim)
  const seen = new Set();
  const merged = [];

  [...baseCases, ...keywordCases].forEach(tc => {
    const key = tc.scenario.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(tc);
    }
  });

  // Langkah 5: Beri nomor ID urut TC-001, TC-002, dst
  return merged.map((tc, idx) => ({
    id:           `TC-${String(idx + 1).padStart(3, '0')}`,
    scenario:     tc.scenario,
    prerequisite: tc.prerequisite,
    steps:        tc.steps,
    expected:     tc.expected,
    type:         tc.type,
    priority:     tc.priority
  }));
}

/* ── 7. RENDER TABEL ── */
function renderTable(cases) {
  elTableBody.innerHTML = '';

  if (cases.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" style="text-align:center;color:var(--color-text-muted);padding:32px">
      Tidak ada kasus uji yang cocok dengan filter ini.
    </td>`;
    elTableBody.appendChild(tr);
    return;
  }

  cases.forEach(tc => {
    const tr = document.createElement('tr');

    // Buat daftar langkah sebagai ordered list
    const stepItems = tc.steps.map(s => `<li>${escHtml(s)}</li>`).join('');

    // Pilih kelas badge berdasarkan jenis
    const typeBadgeClass = {
      'Positif': 'badge--positif',
      'Negatif': 'badge--negatif',
      'Edge':    'badge--edge'
    }[tc.type] || 'badge--positif';

    // Pilih kelas prioritas
    const priorityClass = {
      'Tinggi': 'priority--tinggi',
      'Sedang': 'priority--sedang',
      'Rendah': 'priority--rendah'
    }[tc.priority] || 'priority--sedang';

    tr.innerHTML = `
      <td class="col-id">${escHtml(tc.id)}</td>
      <td>${escHtml(tc.scenario)}</td>
      <td>${escHtml(tc.prerequisite)}</td>
      <td><ol class="steps-list">${stepItems}</ol></td>
      <td>${escHtml(tc.expected)}</td>
      <td><span class="badge ${typeBadgeClass}">${escHtml(tc.type)}</span></td>
      <td><span class="priority ${priorityClass}">${escHtml(tc.priority)}</span></td>
    `;
    elTableBody.appendChild(tr);
  });
}

/* ── 8. UPDATE PENGHITUNG TAB ── */
function updateTabCounts(cases) {
  const total = cases.length;
  const pos   = cases.filter(c => c.type === 'Positif').length;
  const neg   = cases.filter(c => c.type === 'Negatif').length;
  const edge  = cases.filter(c => c.type === 'Edge').length;

  cntAll.textContent  = `(${total})`;
  cntPos.textContent  = `(${pos})`;
  cntNeg.textContent  = `(${neg})`;
  cntEdge.textContent = `(${edge})`;

  elTotalBadge.textContent = `${total} kasus uji`;
}

/* ── 9. FILTER AKTIF ── */
function applyFilter(filter) {
  activeFilter = filter;

  // Update aria-selected & kelas tombol tab
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle('tab-btn--active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  // Filter test case dan render ulang
  const filtered = filter === 'all'
    ? allTestCases
    : allTestCases.filter(tc => tc.type === filter);

  renderTable(filtered);
}

/* ── 10. TAMPILKAN / SEMBUNYIKAN HASIL ── */
function showResults(cases) {
  elEmptyState.classList.add('hidden');
  elResultCard.classList.remove('hidden');

  updateTabCounts(cases);
  applyFilter('all'); // Reset ke tab "Seluruh"
}

function showEmpty() {
  elEmptyState.classList.remove('hidden');
  elResultCard.classList.add('hidden');
}

/* ── 11. HELPER: ESCAPE HTML ──
   Mencegah XSS saat memasukkan teks pengguna ke dalam DOM.
*/
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── 12. HELPER: TOAST NOTIFIKASI ── */
function showToast(message, duration = 2800) {
  elToast.textContent = message;
  elToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), duration);
}

/* ── 13. KONVERSI KE MARKDOWN ── */
function toMarkdown(cases) {
  const header = '| ID | Skenario | Prasyarat | Langkah | Hasil yang Diharapkan | Jenis | Kepentingan |\n'
               + '|----|----------|-----------|---------|----------------------|-------|-------------|';

  const rows = cases.map(tc => {
    const steps = tc.steps.map((s, i) => `${i + 1}. ${s}`).join(' ');
    return `| ${tc.id} | ${tc.scenario} | ${tc.prerequisite} | ${steps} | ${tc.expected} | ${tc.type} | ${tc.priority} |`;
  });

  return `# Kasus Uji — TestCase Genie\n\n${header}\n${rows.join('\n')}`;
}

/* ── 14. KONVERSI KE CSV ── */
function toCsv(cases) {
  const BOM = '\uFEFF'; // BOM untuk mendukung karakter Indonesia di Excel
  const headers = ['ID', 'Skenario', 'Prasyarat', 'Langkah', 'Hasil yang Diharapkan', 'Jenis', 'Tingkat Kepentingan'];

  const escape = val => `"${String(val).replace(/"/g, '""')}"`;

  const rows = cases.map(tc => {
    const steps = tc.steps.map((s, i) => `${i + 1}. ${s}`).join(' | ');
    return [tc.id, tc.scenario, tc.prerequisite, steps, tc.expected, tc.type, tc.priority]
      .map(escape)
      .join(',');
  });

  return BOM + [headers.map(escape).join(','), ...rows].join('\r\n');
}

/* ── 15. EKSPOR FILE ── */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── 16. EVENT LISTENERS ── */

/* Tombol: Buat Kasus Uji */
elBtnGenerate.addEventListener('click', () => {
  const story       = elUserStory.value.trim();
  const featureType = elFeatureType.value;

  if (!story) {
    elUserStory.focus();
    showToast('⚠️ Masukkan cerita pengguna terlebih dahulu.');
    elUserStory.style.borderColor = 'var(--color-negative)';
    setTimeout(() => { elUserStory.style.borderColor = ''; }, 2000);
    return;
  }

  allTestCases = generateTestCases(story, featureType);
  showResults(allTestCases);
  showToast(`✅ ${allTestCases.length} kasus uji berhasil dibuat!`);
});

/* Tombol: Reset */
elBtnReset.addEventListener('click', () => {
  elUserStory.value = '';
  elFeatureType.value = elFeatureType.options[0].value;
  allTestCases = [];
  showEmpty();
  elUserStory.focus();
  showToast('🔄 Semua data telah direset.');
});

/* Tombol: Salin sebagai Markdown */
elBtnCopyMd.addEventListener('click', () => {
  const md = toMarkdown(
    activeFilter === 'all'
      ? allTestCases
      : allTestCases.filter(tc => tc.type === activeFilter)
  );

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(md)
      .then(() => showToast('📄 Markdown berhasil disalin ke clipboard!'))
      .catch(() => fallbackCopy(md));
  } else {
    fallbackCopy(md);
  }
});

/* Fallback salin untuk browser lama */
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('📄 Markdown berhasil disalin ke clipboard!');
  } catch {
    showToast('❌ Gagal menyalin. Coba salin secara manual.');
  }
  document.body.removeChild(ta);
}

/* Tombol: Ekspor CSV */
elBtnExportCsv.addEventListener('click', () => {
  const cases = activeFilter === 'all'
    ? allTestCases
    : allTestCases.filter(tc => tc.type === activeFilter);

  const csv      = toCsv(cases);
  const filename = `testcase-genie-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
  showToast(`⬇ File CSV "${filename}" berhasil diunduh!`);
});

/* Tombol: Filter Tab */
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
});

/* Keyboard: Enter di textarea memicu generate jika Ctrl+Enter */
elUserStory.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    elBtnGenerate.click();
  }
});

/* ── 17. INISIALISASI ── */
(function init() {
  showEmpty(); // Tampilkan empty state saat halaman pertama dimuat
})();
