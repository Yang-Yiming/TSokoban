import { createDialog } from './dialog';
import { settingsManager } from '../settings';

export function showSettingsDialog(container: HTMLElement) {
  const { paper } = createDialog(container, '设置');
  
  const vbox = document.createElement('div');
  vbox.className = 'settings-vbox';
  
  const settings = settingsManager.currentSettings;

  // Animation Speed
  vbox.appendChild(createSettingsRow('动画速度', 'range', 50, 500, settings.moveAnimDuration, (val) => {
    settingsManager.updateSettings({ moveAnimDuration: parseInt(val) });
  }));

  // Volume
  vbox.appendChild(createSettingsRow('音量', 'range', 0, 100, settings.volume, (val) => {
    settingsManager.updateSettings({ volume: parseInt(val) });
  }));

  // A* Smart Check
  const aStarRow = document.createElement('div');
  aStarRow.className = 'settings-row';
  const aStarLabel = document.createElement('label');
  aStarLabel.innerText = '采用更智能的无解判断';
  const aStarCheck = document.createElement('input');
  aStarCheck.type = 'checkbox';
  aStarCheck.checked = settings.useAStar;
  aStarCheck.onchange = () => {
    settingsManager.updateSettings({ useAStar: aStarCheck.checked });
  };
  const aStarText = document.createElement('span');
  aStarText.innerText = '启用A*';
  aStarRow.appendChild(aStarLabel);
  const checkContainer = document.createElement('div');
  checkContainer.appendChild(aStarCheck);
  checkContainer.appendChild(aStarText);
  aStarRow.appendChild(checkContainer);
  vbox.appendChild(aStarRow);

  // Map Seed
  const seedRow = document.createElement('div');
  seedRow.className = 'settings-row';
  const seedLabel = document.createElement('label');
  seedLabel.innerText = '设定地图生成种子';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.value = settings.mapSeed;
  seedInput.oninput = () => {
    settingsManager.updateSettings({ mapSeed: seedInput.value });
  };
  seedRow.appendChild(seedLabel);
  seedRow.appendChild(seedInput);
  vbox.appendChild(seedRow);
  
  paper.appendChild(vbox);
}

function createSettingsRow(labelText: string, type: string, min: number, max: number, value: any, onChange: (val: string) => void) {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const label = document.createElement('label');
  label.innerText = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.min = min.toString();
  input.max = max.toString();
  input.value = value.toString();
  input.oninput = () => onChange(input.value);
  row.appendChild(label);
  row.appendChild(input);
  return row;
}
