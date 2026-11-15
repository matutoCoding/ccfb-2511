import type { AppData } from './types';
import { defaultData } from './defaults';

const KEY = 'nvs.appData.v1';

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw) as AppData;
    if (!parsed.schemes || !parsed.films || !parsed.settings) return defaultData();
    return parsed;
  } catch {
    return defaultData();
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function exportJson(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `夜间视认性仿真数据_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importJson(file: File): Promise<AppData> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result)) as AppData;
        if (!parsed.schemes || !parsed.films || !parsed.settings) {
          reject(new Error('文件结构不完整,缺少 schemes/films/settings'));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsText(file);
  });
}
