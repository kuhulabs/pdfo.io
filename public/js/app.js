const TOOL_LIST = [
  ['merge-pdf', 'Merge PDF', 'Combine multiple PDFs into one'],
  ['split-pdf', 'Split PDF', 'Split by page range or single pages'],
  ['compress-pdf', 'Compress PDF', 'Reduce file size quickly'],
  ['pdf-to-jpg', 'PDF to JPG', 'Convert PDF pages to images'],
  ['jpg-to-pdf', 'JPG to PDF', 'Build a PDF from image files'],
  ['word-to-pdf', 'Word to PDF', 'DOCX to PDF conversion'],
  ['pdf-to-word', 'PDF to Word', 'Convert PDF to DOCX'],
  ['rotate-pdf', 'Rotate PDF', 'Rotate selected pages'],
  ['watermark-pdf', 'Add Watermark', 'Apply text watermarks'],
  ['protect-pdf', 'Protect PDF', 'Set PDF password protection'],
  ['unlock-pdf', 'Unlock PDF', 'Remove PDF passwords'],
  ['add-page-numbers', 'Page Numbers', 'Insert page numbers']
];

function showToast(message, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function bytes(n){if(!n)return'0 B';const u=['B','KB','MB','GB'];let i=0;let x=n;while(x>1024&&i<u.length-1){x/=1024;i++}return `${x.toFixed(2)} ${u[i]}`}

function initDarkMode() {
  const key = 'pdfo-dark-mode';
  if (localStorage.getItem(key) === 'true') document.body.classList.add('dark');
  document.querySelectorAll('[data-dark-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      localStorage.setItem(key, document.body.classList.contains('dark'));
    });
  });
}

function initCookieBanner() {
  if (localStorage.getItem('pdfo-cookies')) return;
  const bar = document.createElement('div');
  bar.className = 'fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-4 text-sm z-50 flex flex-wrap gap-3 justify-between';
  bar.innerHTML = '<span>PDFo uses essential cookies for secure auth and usage tracking.</span><button class="bg-[#FF5C5C] px-4 py-2 rounded">Accept</button>';
  bar.querySelector('button').onclick = () => { localStorage.setItem('pdfo-cookies', 'accepted'); bar.remove(); };
  document.body.appendChild(bar);
}

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  initCookieBanner();
});
