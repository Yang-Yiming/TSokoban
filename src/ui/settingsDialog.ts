import { createDialog } from './dialog';
import { settingsManager } from '../settings';
import { worldManager } from '../save';

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

  // Map Seed (= which world save is active)
  const seedRow = document.createElement('div');
  seedRow.className = 'settings-row';
  const seedLabel = document.createElement('label');
  seedLabel.innerText = '世界种子（每个种子是独立世界）';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.value = settings.mapSeed;
  seedInput.onchange = () => {
    settingsManager.updateSettings({ mapSeed: seedInput.value });
    worldManager.setActiveSeed(seedInput.value);
  };
  seedRow.appendChild(seedLabel);
  seedRow.appendChild(seedInput);
  vbox.appendChild(seedRow);

  const structurePromptRow = document.createElement('div');
  structurePromptRow.className = 'settings-row';
  const structurePromptLabel = document.createElement('label');
  structurePromptLabel.innerText = '特殊地形提示';
  const structurePromptSelect = document.createElement('select');
  const optionAlways = document.createElement('option');
  optionAlways.value = 'always';
  optionAlways.innerText = '每次遇到都提示';
  const optionFirstOnly = document.createElement('option');
  optionFirstOnly.value = 'firstOnly';
  optionFirstOnly.innerText = '仅首次遇到提示';
  structurePromptSelect.appendChild(optionAlways);
  structurePromptSelect.appendChild(optionFirstOnly);
  structurePromptSelect.value = settings.structureDiscoveryPromptMode;
  structurePromptSelect.onchange = () => {
    settingsManager.updateSettings({
      structureDiscoveryPromptMode: structurePromptSelect.value as 'always' | 'firstOnly'
    });
  };
  structurePromptRow.appendChild(structurePromptLabel);
  structurePromptRow.appendChild(structurePromptSelect);
  vbox.appendChild(structurePromptRow);
  
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
