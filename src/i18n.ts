export type Lang = 'th' | 'en';

const th = {
  appName: 'ลบพื้นหลังรูป',
  tagline: 'ทำงานในเบราว์เซอร์ของคุณทั้งหมด — รูปไม่ถูกอัปโหลดไปที่ไหน',
  dropTitle: 'ลากรูปมาวางที่นี่',
  dropSub: 'หรือคลิกเพื่อเลือกไฟล์ · วางจากคลิปบอร์ดได้ด้วย Ctrl+V / ⌘+V',
  dropFormats: 'รองรับ JPG, PNG, WebP (ภาพใหญ่จะถูกย่อด้านยาวสุดเหลือ 4096 px)',
  chooseFile: 'เลือกรูป',
  firstRunNote: 'ครั้งแรกต้องดาวน์โหลดโมเดล AI ประมาณ 170–260 MB (เก็บแคชไว้ในเบราว์เซอร์ ครั้งต่อไปเร็วขึ้น)',
  secSelect: 'เลือกวัตถุด้วยการคลิก',
  toolAdd: 'คลิกเพิ่มวัตถุ',
  toolRemove: 'คลิกเอาวัตถุออก',
  hintClick: 'เคล็ดลับ: คลิกขวา = เอาออก, Shift+คลิก = เพิ่ม',
  candTitle: 'ขนาดส่วนที่เลือก (คลิกล่าสุด)',
  candSmall: 'เล็ก',
  candMedium: 'กลาง',
  candLarge: 'ใหญ่',
  secBrush: 'แปรงเก็บรายละเอียด',
  toolBrushAdd: 'แปรงเพิ่ม',
  toolBrushRemove: 'แปรงลบ',
  brushSize: 'ขนาดแปรง',
  secHistory: 'แก้ไข',
  undo: 'เลิกทำ',
  redo: 'ทำซ้ำ',
  resetAuto: 'กลับไปผลอัตโนมัติ',
  clearAll: 'ล้างการเลือกทั้งหมด',
  selectAll: 'เลือกทั้งภาพ',
  secView: 'แสดงผล',
  viewResult: 'ผลลัพธ์',
  viewOverlay: 'ซ้อนมาสก์',
  viewOriginal: 'ต้นฉบับ',
  bg: 'พื้นหลังตัวอย่าง',
  bgChecker: 'ลายตาราง',
  bgWhite: 'ขาว',
  bgBlack: 'ดำ',
  bgGreen: 'เขียว',
  secExport: 'ส่งออก',
  cropToContent: 'ครอปให้พอดีวัตถุ',
  download: 'ดาวน์โหลด PNG (โปร่งใส)',
  newImage: 'เปิดรูปใหม่',
  secModel: 'โมเดลลบพื้นหลังอัตโนมัติ',
  modelBiRefNet: 'BiRefNet lite 512 — คุณภาพดี วัตถุทั่วไป (~98–192 MB)',
  modelModnet: 'MODNet — เร็ว เหมาะกับภาพคนเท่านั้น (~26 MB)',
  rerun: 'ประมวลผลใหม่',
  stInit: 'กำลังเตรียมระบบ…',
  stIdle: 'พร้อมใช้งาน — เปิดรูปเพื่อเริ่ม',
  stLoadAuto: 'กำลังโหลดโมเดลลบพื้นหลัง…',
  stRunAuto: 'กำลังลบพื้นหลังอัตโนมัติ…',
  stLoadSam: 'กำลังโหลดโมเดลคลิกเลือกวัตถุ…',
  stRunSam: 'กำลังวิเคราะห์ภาพสำหรับการคลิกเลือก…',
  stReady: 'เสร็จแล้ว — คลิกที่วัตถุเพื่อเพิ่ม/เอาออก หรือดาวน์โหลดได้เลย',
  stSegmenting: 'กำลังหาขอบวัตถุ…',
  stSamNotReady: 'ยังเตรียมโหมดคลิกเลือกไม่เสร็จ รอสักครู่',
  stFallback: 'WebGPU ใช้ไม่ได้ เปลี่ยนไปใช้ WASM (ช้ากว่า)',
  stError: 'เกิดข้อผิดพลาด',
  stDownloaded: 'บันทึกไฟล์แล้ว',
  stEmpty: 'ไม่มีส่วนที่ถูกเลือก — ไฟล์ที่ได้จะโปร่งใสทั้งภาพ',
  stNotImage: 'ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ',
  engine: 'เครื่องประมวลผล',
  privacy: 'ความเป็นส่วนตัว: รูปของคุณประมวลผลในเครื่องนี้เท่านั้น ระบบดาวน์โหลดเฉพาะไฟล์โมเดลจาก Hugging Face',
  licenses: 'โมเดล: BiRefNet (MIT), SlimSAM (Apache-2.0), MODNet (Apache-2.0)',
  kept: 'ส่วนที่เก็บไว้',
};

const en: typeof th = {
  appName: 'Background Remover',
  tagline: 'Runs entirely in your browser — your images are never uploaded',
  dropTitle: 'Drop an image here',
  dropSub: 'or click to choose a file · paste with Ctrl+V / ⌘+V',
  dropFormats: 'JPG, PNG, WebP (large images are scaled to 4096 px on the long side)',
  chooseFile: 'Choose image',
  firstRunNote: 'First run downloads ~170–260 MB of AI models (cached by your browser afterwards)',
  secSelect: 'Click to select objects',
  toolAdd: 'Click to add object',
  toolRemove: 'Click to remove object',
  hintClick: 'Tip: right-click = remove, Shift+click = add',
  candTitle: 'Selection size (last click)',
  candSmall: 'Small',
  candMedium: 'Medium',
  candLarge: 'Large',
  secBrush: 'Refine with brush',
  toolBrushAdd: 'Brush: keep',
  toolBrushRemove: 'Brush: erase',
  brushSize: 'Brush size',
  secHistory: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  resetAuto: 'Back to automatic result',
  clearAll: 'Clear selection',
  selectAll: 'Select whole image',
  secView: 'View',
  viewResult: 'Result',
  viewOverlay: 'Mask overlay',
  viewOriginal: 'Original',
  bg: 'Preview background',
  bgChecker: 'Checkerboard',
  bgWhite: 'White',
  bgBlack: 'Black',
  bgGreen: 'Green',
  secExport: 'Export',
  cropToContent: 'Crop to subject',
  download: 'Download PNG (transparent)',
  newImage: 'Open another image',
  secModel: 'Automatic removal model',
  modelBiRefNet: 'BiRefNet lite 512 — good quality, any subject (~98–192 MB)',
  modelModnet: 'MODNet — fast, portraits/people only (~26 MB)',
  rerun: 'Run again',
  stInit: 'Starting…',
  stIdle: 'Ready — open an image to begin',
  stLoadAuto: 'Loading background-removal model…',
  stRunAuto: 'Removing background…',
  stLoadSam: 'Loading click-to-select model…',
  stRunSam: 'Analysing image for click selection…',
  stReady: 'Done — click objects to add/remove, or download now',
  stSegmenting: 'Finding object edges…',
  stSamNotReady: 'Click selection is still preparing, please wait',
  stFallback: 'WebGPU unavailable, using WASM (slower)',
  stError: 'Something went wrong',
  stDownloaded: 'File saved',
  stEmpty: 'Nothing is selected — the file will be fully transparent',
  stNotImage: 'This file is not a supported image',
  engine: 'Engine',
  privacy: 'Privacy: images are processed on this device only; only model files are downloaded from Hugging Face',
  licenses: 'Models: BiRefNet (MIT), SlimSAM (Apache-2.0), MODNet (Apache-2.0)',
  kept: 'Kept',
};

export type Key = keyof typeof th;
const dict: Record<Lang, typeof th> = { th, en };

let lang: Lang = (() => {
  try {
    const s = localStorage.getItem('lang');
    if (s === 'th' || s === 'en') return s;
  } catch {
    /* ignore */
  }
  return 'th';
})();

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* ignore */
  }
  applyI18n();
}
export const t = (k: Key) => dict[lang][k] ?? k;

export function applyI18n(root: ParentNode = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
}
