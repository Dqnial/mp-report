import { Group, Loader, Text, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCloudCheck,
  IconCloudOff,
  IconClockHour4,
} from '@tabler/icons-react';
import { useSyncStatus } from '../api/queries';
import { retryFailed, syncNow } from '../offline/sync';
import { plural } from '../plural';

/**
 * Всегда на виду: всё ли дошло до сервера. Нажатие — отправить сейчас
 * (при ошибке — попробовать ещё раз).
 */
export function SyncBadge() {
  const s = useSyncStatus();

  let icon = <IconCloudCheck size={18} />;
  let color = 'teal.7';
  let text = 'Всё на сервере';
  if (s.errors) {
    icon = <IconAlertTriangle size={18} />;
    color = 'red.7';
    text = `Сервер не принял: ${s.errors}. Нажмите, чтобы повторить`;
  } else if (s.authRequired) {
    icon = <IconAlertTriangle size={18} />;
    color = 'orange.8';
    text = `Ждут отправки: ${s.pending} — войдите заново`;
  } else if (s.pending) {
    icon = s.syncing ? <Loader size={14} /> : <IconClockHour4 size={18} />;
    color = 'orange.8';
    text = `${s.pending} ${plural(s.pending, ['визит', 'визита', 'визитов'])} ${plural(s.pending, ['ждёт', 'ждут', 'ждут'])} отправки`;
    if (s.offline) text += ' · нет сети';
  } else if (s.offline) {
    icon = <IconCloudOff size={18} />;
    color = 'gray.6';
    text = 'Нет сети · всё сохранено на телефоне';
  } else if (s.pulling.length) {
    icon = <Loader size={14} />;
    color = 'gray.6';
    text = 'Обновляю данные…';
  }

  return (
    <UnstyledButton
      onClick={() => void (s.errors ? retryFailed() : syncNow())}
      aria-label="Синхронизация"
    >
      <Group gap={6} justify="center" c={color} wrap="nowrap">
        {icon}
        <Text size="sm" c={color} fw={500}>
          {text}
        </Text>
      </Group>
    </UnstyledButton>
  );
}
