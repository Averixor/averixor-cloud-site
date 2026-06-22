/**
 * Averixor Cloud — редактори: документ, таблиця, презентація, PDF, ZIP
 */
(() => {
  'use strict';

  function bytesToBase64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const DocumentEditor = {
    quill: null,
    container: null,

    mount(container) {
      this.container = container;
      container.innerHTML = `
        <div class="ws-doc-editor">
          <div class="ws-doc-toolbar"><div id="ws-quill-toolbar"></div></div>
          <div id="ws-quill-editor"></div>
        </div>`;
      this.quill = new Quill('#ws-quill-editor', {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'blockquote', 'code-block'],
            [{ align: [] }],
            ['clean'],
          ],
        },
      });
    },

    load(content) {
      if (!this.quill) return;
      const sanitize = window.WorkspaceSecurity?.sanitizeHtml || ((html) => html);
      try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        if (parsed.delta) {
          this.quill.setContents(parsed.delta);
          return;
        }
        if (parsed.html) {
          this.quill.root.innerHTML = sanitize(parsed.html);
          return;
        }
      } catch {
        if (typeof content === 'string' && content.trim().startsWith('<')) {
          this.quill.root.innerHTML = sanitize(content);
          return;
        }
      }
      this.quill.root.innerHTML = '<p></p>';
    },

    serialize() {
      return JSON.stringify({
        html: this.quill.root.innerHTML,
        delta: this.quill.getContents(),
      });
    },

    exportHtml() {
      return this.quill.root.innerHTML;
    },

    destroy() {
      if (this.container) this.container.innerHTML = '';
      this.quill = null;
    },
  };

  const SpreadsheetEditor = {
    container: null,
    instance: null,
    el: null,

    mount(container) {
      this.container = container;
      container.innerHTML = '<div id="ws-jexcel" style="width:100%;height:calc(100vh - 140px);overflow:auto"></div>';
      this.el = container.querySelector('#ws-jexcel');
    },

    load(content) {
      let data = [['', '', ''], ['', '', '']];
      try {
        const parsed = JSON.parse(content);
        if (parsed.data) {
          data = parsed.data.map((row) => row.map((cell) => {
            const v = cell && typeof cell === 'object' ? cell.v : cell;
            return v ?? '';
          }));
        }
      } catch {
        data = [['']];
      }

      if (this.instance && window.jspreadsheet) {
        window.jspreadsheet.destroy(this.el);
      }

      this.instance = window.jspreadsheet(this.el, {
        data,
        minDimensions: [12, 8],
        tableOverflow: true,
        tableHeight: 'calc(100vh - 160px)',
        onchange: () => document.dispatchEvent(new CustomEvent('ws-dirty')),
      });
    },

    serialize() {
      if (!this.instance) return JSON.stringify({ data: [[{ v: '' }]] });
      const raw = this.instance.getData();
      const data = raw.map((row) => row.map((v) => ({ v: v ?? '' })));
      return JSON.stringify({ data: data.length ? data : [[{ v: '' }]] });
    },

    exportXlsx() {
      if (!window.XLSX || !this.instance) return null;
      const aoa = this.instance.getData();
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Аркуш1');
      return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    },

    destroy() {
      if (this.instance && this.el && window.jspreadsheet) {
        try { window.jspreadsheet.destroy(this.el); } catch (_) { /* empty */ }
      }
      this.instance = null;
      if (this.container) this.container.innerHTML = '';
    },
  };

  const PresentationEditor = {
    container: null,
    slides: [],
    active: 0,

    mount(container) {
      this.container = container;
      container.innerHTML = `
        <div class="ws-slides-editor">
          <div class="ws-slides-list" id="ws-slides-list"></div>
          <div class="ws-slide-canvas" id="ws-slide-canvas"></div>
        </div>`;
      document.getElementById('ws-slides-list').addEventListener('click', (e) => {
        const thumb = e.target.closest('.ws-slide-thumb');
        if (!thumb) return;
        this.active = Number(thumb.dataset.index);
        this.render();
      });
    },

    load(content) {
      try {
        const parsed = JSON.parse(content);
        this.slides = parsed.slides || [{ title: 'Слайд 1', body: '' }];
      } catch {
        this.slides = [{ title: 'Слайд 1', body: content || '' }];
      }
      this.active = 0;
      this.render();
    },

    render() {
      const list = document.getElementById('ws-slides-list');
      const canvas = document.getElementById('ws-slide-canvas');
      if (!list || !canvas) return;

      list.innerHTML = this.slides.map((s, i) => `
        <button type="button" class="ws-slide-thumb ${i === this.active ? 'is-active' : ''}" data-index="${i}">
          Слайд ${i + 1}<br>${(s.title || '').slice(0, 20)}
        </button>`).join('');

      const slide = this.slides[this.active] || { title: '', body: '' };
      canvas.innerHTML = `
        <label>Заголовок<input type="text" id="ws-slide-title" value="${escapeAttr(slide.title || '')}"></label>
        <label>Зміст (кожен рядок — пункт списку)<textarea id="ws-slide-body">${escapeHtml(slide.body || '')}</textarea></label>
        <div class="ws-slide-preview" id="ws-slide-preview"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="button button-secondary" id="ws-slide-add">+ Слайд</button>
          <button type="button" class="button button-secondary" id="ws-slide-del">Видалити слайд</button>
        </div>`;

      const titleEl = document.getElementById('ws-slide-title');
      const bodyEl = document.getElementById('ws-slide-body');
      const preview = () => {
        slide.title = titleEl.value;
        slide.body = bodyEl.value;
        const lines = slide.body.split('\n').filter(Boolean);
        document.getElementById('ws-slide-preview').innerHTML = `
          <h3>${escapeHtml(slide.title)}</h3>
          ${lines.length ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '<p style="color:var(--muted)">Додайте текст</p>'}`;
      };
      titleEl.addEventListener('input', preview);
      bodyEl.addEventListener('input', preview);
      preview();

      document.getElementById('ws-slide-add').onclick = () => {
        this.slides.push({ title: `Слайд ${this.slides.length + 1}`, body: '' });
        this.active = this.slides.length - 1;
        this.render();
      };
      document.getElementById('ws-slide-del').onclick = () => {
        if (this.slides.length <= 1) return;
        this.slides.splice(this.active, 1);
        this.active = Math.max(0, this.active - 1);
        this.render();
      };
    },

    serialize() {
      return JSON.stringify({ slides: this.slides });
    },

    destroy() {
      if (this.container) this.container.innerHTML = '';
      this.slides = [];
    },
  };

  const PdfEditor = {
    container: null,
    pdfDoc: null,
    pageNum: 1,
    pdfBytes: null,
    annotations: [],

    mount(container) {
      this.container = container;
      container.innerHTML = `
        <div class="ws-pdf-wrap">
          <div class="ws-pdf-toolbar">
            <button type="button" class="button button-secondary" id="ws-pdf-prev">←</button>
            <span id="ws-pdf-page-info">Стор. 1</span>
            <button type="button" class="button button-secondary" id="ws-pdf-next">→</button>
            <input type="text" id="ws-pdf-annotate" placeholder="Текст для додавання на PDF" style="flex:1;min-width:160px;padding:8px 12px;border-radius:10px;border:1px solid var(--ws-line);background:var(--ws-panel);color:var(--text)">
            <button type="button" class="button button-primary" id="ws-pdf-add-text">Додати текст</button>
            <button type="button" class="button button-secondary" id="ws-pdf-del-anno" title="Видалити останню анотацію на сторінці">✕</button>
          </div>
          <div class="ws-pdf-canvas-wrap"><canvas id="ws-pdf-canvas"></canvas></div>
        </div>`;
    },

    async load(data) {
      this.annotations = [];
      let pdfBytes = null;

      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.v === 1 && parsed.pdf) {
            pdfBytes = base64ToBytes(parsed.pdf);
            this.annotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];
          }
        } catch {
          /* legacy raw string — ignore */
        }
      } else if (data instanceof ArrayBuffer) {
        pdfBytes = new Uint8Array(data);
      } else if (data instanceof Uint8Array) {
        pdfBytes = data;
      }

      if (!pdfBytes) throw new Error('Невідомий формат PDF');

      this.pdfBytes = pdfBytes;
      const pdfjsLib = window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      this.pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
      this.pageNum = 1;
      await this.renderPage();
      this.bindToolbar();
    },

    bindToolbar() {
      document.getElementById('ws-pdf-prev').onclick = () => {
        if (this.pageNum <= 1) return;
        this.pageNum--;
        this.renderPage();
      };
      document.getElementById('ws-pdf-next').onclick = () => {
        if (this.pageNum >= this.pdfDoc.numPages) return;
        this.pageNum++;
        this.renderPage();
      };
      document.getElementById('ws-pdf-add-text').onclick = () => {
        const text = document.getElementById('ws-pdf-annotate').value.trim();
        if (!text) return;
        this.annotations.push({ page: this.pageNum, text, x: 50, y: 50 });
        this.renderPage();
        document.dispatchEvent(new CustomEvent('ws-dirty'));
      };
      const delBtn = document.getElementById('ws-pdf-del-anno');
      if (delBtn) delBtn.onclick = () => {
        // remove last anno on current page
        for (let i = this.annotations.length - 1; i >= 0; i--) {
          if (this.annotations[i].page === this.pageNum) {
            this.annotations.splice(i, 1);
            this.renderPage();
            document.dispatchEvent(new CustomEvent('ws-dirty'));
            break;
          }
        }
      };
    },

    async renderPage() {
      const page = await this.pdfDoc.getPage(this.pageNum);
      const scale = 1.5;
      const viewport = page.getViewport({ scale });
      const canvas = document.getElementById('ws-pdf-canvas');
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: ctx, viewport }).promise;
      document.getElementById('ws-pdf-page-info').textContent = `Стор. ${this.pageNum} / ${this.pdfDoc.numPages}`;
      ctx.fillStyle = '#38bdf8';
      ctx.font = '14px Inter, sans-serif';
      this.annotations.filter((a) => a.page === this.pageNum).forEach((a) => {
        ctx.fillText(a.text, a.x, a.y);
      });
    },

    serialize() {
      if (!this.pdfBytes) return null;
      return JSON.stringify({
        v: 1,
        pdf: bytesToBase64(this.pdfBytes),
        annotations: this.annotations,
      });
    },

    async exportPdf() {
      if (!window.PDFLib || !this.pdfBytes) return null;
      const { PDFDocument, rgb } = PDFLib;
      const pdfDoc = await PDFDocument.load(this.pdfBytes);
      const pages = pdfDoc.getPages();
      this.annotations.forEach((a) => {
        const page = pages[a.page - 1];
        if (!page) return;
        page.drawText(a.text, { x: a.x, y: page.getHeight() - a.y, size: 12, color: rgb(0.22, 0.74, 0.97) });
      });
      const saved = await pdfDoc.save();
      this.pdfBytes = saved;
      return saved;
    },

    destroy() {
      this.pdfDoc = null;
      this.pdfBytes = null;
      this.annotations = [];
      if (this.container) this.container.innerHTML = '';
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  async function importXlsxToContent(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const data = aoa.map((row) => row.map((v) => ({ v })));
    return JSON.stringify({ data: data.length ? data : [[{ v: '' }]] });
  }

  async function importCsvToContent(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.length);
    const data = lines.map((line) => line.split(/[,;]/).map((v) => ({ v: v.trim() })));
    return JSON.stringify({ data: data.length ? data : [[{ v: '' }]] });
  }

  window.WorkspaceEditors = {
    DocumentEditor,
    SpreadsheetEditor,
    PresentationEditor,
    PdfEditor,
    importXlsxToContent,
    importCsvToContent,
  };
})();
