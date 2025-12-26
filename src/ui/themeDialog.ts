import { createDialog } from './dialog';
import { themeManager, THEMES } from '../theme';

export function showThemeDialog(container: HTMLElement) {
  const { paper } = createDialog(container, '主题');
  
  const list = document.createElement('div');
  list.className = 'theme-list';
  
  THEMES.forEach((theme, index) => {
    const option = document.createElement('label');
    option.className = 'theme-option';
    option.style.color = theme.cssColor;
    
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.checked = themeManager.currentTheme === theme;
    
    radio.onchange = () => {
      themeManager.setTheme(index);
    };
    
    option.appendChild(radio);
    option.appendChild(document.createTextNode(theme.name));
    list.appendChild(option);
  });
  
  paper.appendChild(list);
}
