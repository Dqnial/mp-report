import { ActionIcon, Group, Loader, Text, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCloudCheck,
  IconCloudOff,
  IconClockHour4,
} from '@tabler/icons-react';
import { useSyncStatus } from '../api/queries';
import { retryFailed, syncNow } from '../offline/sync';
import { plural } from '../plural';

function useSyncView(iconSize = 18) {
  const s = useSyncStatus();

  let icon = <IconCloudCheck size={iconSize} />;
  let color = 'teal.7';
  let text = 'Всё на сервере';
  if (s.errors) {
    icon = <IconAlertTriangle size={iconSize} />;
    color = 'red.7';
    text = `Сервер не принял: ${s.errors}. Нажмите, чтобы повторить`;
  } else if (s.authRequired) {
    icon = <IconAlertTriangle size={iconSize} />;
    color = 'orange.8';
    text = `Ждут отправки: ${s.pending} — войдите заново`;
  } else if (s.pending) {
    icon = s.syncing ? (
      <Loader size={iconSize - 4} />
    ) : (
      <IconClockHour4 size={iconSize} />
    );
    color = 'orange.8';
    text = `${s.pending} ${plural(s.pending, ['визит', 'визита', 'визитов'])} ${plural(s.pending, ['ждёт', 'ждут', 'ждут'])} отправки`;
    if (s.offline) text += ' · нет сети';
  } else if (s.offline) {
    icon = <IconCloudOff size={iconSize} />;
    color = 'gray.6';
    text = 'Нет сети · всё сохранено на телефоне';
  } else if (s.pulling.length) {
    icon = <Loader size={iconSize - 4} />;
    color = 'gray.6';
    text = 'Обновляю данные…';
  }
  const ok = !s.errors && !s.authRequired && !s.pending && !s.offline;
  const run = () => void (s.errors ? retryFailed() : syncNow());
  return { icon, color, text, ok, run };
}

/**
 * Всегда на виду: всё ли дошло до сервера. Нажатие — отправить сейчас
 * (при ошибке — попробовать ещё раз).
 */
export function SyncBadge({ problemsOnly }: { problemsOnly?: boolean } = {}) {
  const { icon, color, text, ok, run } = useSyncView();
  if (problemsOnly && ok) return null;
  return (
    <UnstyledButton onClick={run} aria-label="Синхронизация">
      <Group gap={6} justify="center" c={color} wrap="nowrap">
        {icon}
        <Text size="sm" c={color} fw={500}>
          {text}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

/**
 * Значок рядом с поиском: зелёное облако — всё на сервере. О проблемах
 * значок только напоминает цветом — текст показывает SyncBadge problemsOnly.
 */
export function SyncIcon() {
  const { icon, color, text, run } = useSyncView(26);
  return (
    <ActionIcon
      size={48}
      radius="md"
      variant="light"
      color={color.split('.')[0]}
      onClick={run}
      aria-label={text}
      title={text}
    >
      {icon}
    </ActionIcon>
  );
}
