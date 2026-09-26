import { createLanguageSwitcher } from '../i18n/language-switcher.js';

const langContainer = document.getElementById('simple-mode-lang-switcher');
if (langContainer) {
  const switcher = createLanguageSwitcher();
  const dropdown = switcher.querySelector('div[role="menu"]');
  if (dropdown) {
    dropdown.classList.remove('mt-2');
    dropdown.classList.add('bottom-full', 'mb-2');
  }
  langContainer.appendChild(switcher);
}
