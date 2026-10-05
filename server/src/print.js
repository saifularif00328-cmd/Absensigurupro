import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, SectionType, TabStopType,
} from 'docx';
import { seededShuffle } from './util.js';

const LETTERS = 'ABCDEF';
const FONT = 'Times New Roman';
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 22, ...o });

// Teks bertingkat baris -> satu paragraf dengan jeda baris
function lines(text, o = {}) {
  const parts = String(text).split(/\r?\n/);
  return parts.map((t, i) => run(t, { ...o, break: i === 0 ? 0 : 1 }));
}

function kop(school) {
  const extra = (() => { try { return JSON.parse(school?.kop_lines || '[]'); } catch { return []; } })();
  const head = extra.length ? extra : [];
  const out = [];
  head.forEach((t) => out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(t, { bold: true, size: 24 })] })));
  out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run((school?.name ?? 'Sekolah').toUpperCase(), { bold: true, size: 30 })] }));
  if (school?.address) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(school.address, { size: 20 })] }));
  out.push(new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.DOUBLE, size: 6, space: 4, color: '000000' } }, children: [] }));
  return out;
}

function infoTable(exam, subjectName, className, student) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const borders = { top: none, bottom: none, left: none, right: none };
  const cell = (t, w, bold = false) => new TableCell({ borders, width: { size: w, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [run(t, { bold })] })] });
  const dots = '.'.repeat(38);
  const rows = [
    ['Mata Pelajaran', subjectName || '-', 'Nama', student ? student.name : dots],
    ['Kelas', className || '-', 'No. Absen / NIS', student ? (student.nis ?? '') : '.'.repeat(20)],
    ['Waktu', `${exam.duration_min} menit`, 'Hari / Tanggal', '.'.repeat(24)],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([a, b, c, d]) => new TableRow({ children: [cell(a, 18), cell(': ' + b, 32), cell(c, 18), cell(': ' + d, 32)] })),
  });
}

function questionBlocks(q, no, shuffleSeed) {
  const out = [new Paragraph({ spacing: { before: 120 }, indent: { left: 360, hanging: 360 }, children: [run(`${no}.\t`), ...lines(q.body)], tabStops: [{ type: TabStopType.LEFT, position: 360 }] })];
  let key;
  if (q.type === 'pg') {
    const idx = q.options.map((_, i) => i);
    const order = shuffleSeed == null ? idx : seededShuffle(idx, shuffleSeed + q.id);
    order.forEach((orig, pos) => out.push(new Paragraph({ indent: { left: 720, hanging: 360 }, children: [run(`${LETTERS[pos]}.\t${q.options[orig]}`)], tabStops: [{ type: TabStopType.LEFT, position: 720 }] })));
    key = LETTERS[order.indexOf(q.answer_key)];
  } else if (q.type === 'bs') {
    out.push(new Paragraph({ indent: { left: 720 }, children: [run('Benar  /  Salah')] }));
    key = q.answer_key ? 'Benar' : 'Salah';
  } else if (q.type === 'isian') {
    out.push(new Paragraph({ indent: { left: 720 }, children: [run('Jawab: ' + '.'.repeat(40))] }));
    key = (q.answer_key ?? []).join(' / ');
  } else {
    for (let i = 0; i < 4; i++) out.push(new Paragraph({ indent: { left: 360 }, spacing: { before: 120 }, border: { bottom: { style: BorderStyle.DOTTED, size: 4, color: '888888', space: 1 } }, children: [] }));
    key = q.answer_key || '(sesuai rubrik guru)';
  }
  return { out, key };
}

export async function buildExamDocx({ school, exam, questions, className, subjectName, students, paket, withKey, columns }) {
  const seed = paket === 'B' ? exam.id * 7919 + 17 : null;
  const ordered = paket === 'B' ? seededShuffle(questions, seed) : questions;
  const keys = [];
  const body = ordered.flatMap((q, i) => {
    const b = questionBlocks(q, i + 1, seed);
    keys.push(`${i + 1}. ${b.key}${q.points ? `  (skor ${q.points})` : ''}`);
    return b.out;
  });
  const page = { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } };
  const title = `NASKAH SOAL ${exam.kind === 'uts' ? 'UJIAN TENGAH SEMESTER' : exam.kind === 'uas' ? 'UJIAN AKHIR SEMESTER' : 'ULANGAN HARIAN'} — PAKET ${paket}`;
  const instr = new Paragraph({ spacing: { before: 120, after: 120 }, children: [run('Petunjuk: ', { bold: true }), run('Berdoalah sebelum mengerjakan. Kerjakan soal yang mudah terlebih dahulu. Periksa kembali jawaban sebelum dikumpulkan.')] });

  const people = students.length ? students : [null];
  const sections = [];
  people.forEach((st, i) => {
    sections.push({
      properties: { type: i === 0 ? SectionType.NEXT_PAGE : SectionType.NEXT_PAGE, page },
      children: [...kop(school), new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(title, { bold: true, size: 24 })] }), infoTable(exam, subjectName, className, st), instr],
    });
    sections.push({
      properties: { type: SectionType.CONTINUOUS, page, column: columns === 2 ? { count: 2, space: 500, separate: true } : undefined },
      children: body.map((p) => p),
    });
  });

  if (withKey) {
    sections.push({
      properties: { type: SectionType.NEXT_PAGE, page },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`KUNCI JAWABAN — ${exam.title} (Paket ${paket})`, { bold: true, size: 26 })] }),
        ...keys.map((k) => new Paragraph({ spacing: { before: 60 }, children: lines(k) })),
      ],
    });
  }
  return Packer.toBuffer(new Document({ creator: 'Absensi Guru Pro', title: exam.title, sections }));
}
