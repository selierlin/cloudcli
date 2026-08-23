import { Preferences } from '@capacitor/preferences';
import { Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PICKER_URL_KEY = 'cloudcli.pickerUrl';

/**
 * 移动端（Capacitor 原生壳）专属的「返回服务器列表」入口。
 *
 * 仅当 App 确实由服务器选择页跳转而来（Preferences 记录了 pickerUrl）时渲染；
 * 浏览器 / PWA / 桌面自建站没有 `window.Capacitor`，组件直接返回 null，不影响任何桌面 UI。
 */
export default function ReturnToServerList() {
  const { t } = useTranslation('sidebar');
  const [pickerUrl, setPickerUrl] = useState<string | null>(null);

  useEffect(() => {
    const isCapacitorShell = Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
    );
    if (!isCapacitorShell) return undefined;

    let disposed = false;
    void Preferences.get({ key: PICKER_URL_KEY })
      .then((res) => {
        if (!disposed && res?.value) setPickerUrl(res.value);
      })
      .catch(() => {
        // 读取失败时保持隐藏即可
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (!pickerUrl) return null;

  return (
    <>
      <div className="nav-divider" />
      <div className="px-3 pt-2 md:hidden">
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={() => {
            window.location.href = pickerUrl;
          }}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-normal text-foreground">{t('actions.backToServerList')}</span>
        </button>
      </div>
    </>
  );
}
