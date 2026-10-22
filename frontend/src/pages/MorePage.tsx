import {
  Alert,
  Badge,
  Button,
  Group,
  List,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSend,
  IconCircleCheck,
  IconCopy,
  IconLogout,
  IconUserPlus,
} from '@tabler/icons-react';
import {
  useCreateInvite,
  useInvites,
  useLogout,
  useMe,
  useSyncStatus,
  useRevokeInvite,
} from '../api/queries';
import { isNative, nativeShareText } from '../native';
import { unsentChanges } from '../plural';
import classes from './MorePage.module.css';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    notifications.show({ message: 'Ссылка скопирована', color: 'teal' });
  } catch {
    notifications.show({
      color: 'orange',
      message: 'Не удалось скопировать — выделите ссылку и скопируйте вручную',
    });
  }
}

/**
 * Ссылку — в WhatsApp через «Поделиться». Вызывается прямо по нажатию
 * (без ожидания сети), иначе браузер откажет. Отказал — копируем.
 */
function shareLink(url: string, expiresAt: string) {
  const text =
    `Здравствуйте! Приглашаю в приложение «Визиты МП» для записи визитов.\n` +
    `Откройте ссылку и придумайте логин и пароль ` +
    `(ссылка одноразовая, действует до ${fmt(expiresAt)}):\n${url}`;
  if (isNative) {
    nativeShareText(text, 'Отправить приглашение').catch(
      () => void copyLink(url),
    );
    return;
  }
  if (!navigator.share) return void copyLink(url);
  navigator.share({ text }).catch((e: Error) => {
    if (e.name !== 'AbortError') void copyLink(url);
  });
}

export function MorePage() {
  const me = useMe().data;
  const logout = useLogout();
  const sync = useSyncStatus();
  // очередь не теряется при выходе — но человек должен знать, что она есть
  const logoutText = sync.pending
    ? `На телефоне ${unsentChanges(sync.pending)}. Они сохранятся и отправятся, когда вы снова войдёте под этим логином. Выйти?`
    : 'Выйти из приложения?';
  // после выхода профиля уже нет — приложение сейчас переключится на вход
  if (!me) return null;

  return (
    <Stack gap="md">
      <Title order={2}>Ещё</Title>

      <Paper withBorder p="md">
        <Text fw={600}>{me.fullName}</Text>
        <Text size="sm" c="dimmed">
          Логин: {me.login}
        </Text>
      </Paper>

      {me.isAdmin && <InvitesBlock />}

      <Button
        variant="light"
        color="red"
        leftSection={<IconLogout />}
        loading={logout.isPending}
        onClick={() => {
          if (window.confirm(logoutText)) logout.mutate();
        }}
      >
        Выйти
      </Button>
    </Stack>
  );
}

function InvitesBlock() {
  const invites = useInvites(true);
  const create = useCreateInvite();
  const revoke = useRevokeInvite();

  const now = new Date();
  const list = invites.data ?? [];
  const waiting = list.filter((i) => !i.usedAt && new Date(i.expiresAt) > now);
  const joined = list.filter((i) => i.usedBy);

  // Новая ссылка видна только сразу после создания (сервер хранит лишь хеш).
  // Прячем её, как только она перестала работать: её отменили, по ней уже
  // зарегистрировались или она истекла — список приглашений главнее.
  const fresh = create.data?.url ? create.data : null;
  const freshAlive =
    fresh && (!invites.data || waiting.some((i) => i.id === fresh.id));

  const cancel = (id: string) => {
    if (
      !window.confirm(
        'Отменить приглашение? Коллега больше не сможет зарегистрироваться по этой ссылке.',
      )
    ) {
      return;
    }
    revoke.mutate(id, {
      onSuccess: () => {
        if (fresh?.id === id) create.reset();
        notifications.show({ message: 'Приглашение отменено', color: 'gray' });
      },
    });
  };

  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        <div>
          <Text fw={600} size="lg">
            Пригласить коллегу
          </Text>
          <List type="ordered" size="sm" c="dimmed" mt={6} spacing={2}>
            <List.Item>Создайте ссылку-приглашение</List.Item>
            <List.Item>Отправьте её коллеге в WhatsApp</List.Item>
            <List.Item>
              Коллега откроет её и сам придумает логин и пароль
            </List.Item>
          </List>
          <Text size="xs" c="dimmed" mt={6}>
            Ссылка одноразовая и работает 7 дней.
          </Text>
        </div>

        {freshAlive && fresh ? (
          <Paper withBorder p="sm" radius="md" className={classes.fresh}>
            <Stack gap="xs">
              <Group gap={6} wrap="nowrap">
                <IconCircleCheck
                  size={20}
                  color="var(--mantine-color-teal-7)"
                />
                <Text fw={600}>Ссылка готова — отправьте её коллеге</Text>
              </Group>
              <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                {fresh.url}
              </Text>
              <Text size="xs" c="dimmed">
                Действует до {fmt(fresh.expiresAt)}, сработает один раз. Видна
                только сейчас — если потеряется, создайте новую.
              </Text>
              <Button
                color="green"
                size="md"
                leftSection={<IconSend />}
                onClick={() => shareLink(fresh.url!, fresh.expiresAt)}
              >
                Отправить коллеге
              </Button>
              <Button
                variant="light"
                leftSection={<IconCopy size={18} />}
                onClick={() => void copyLink(fresh.url!)}
              >
                Копировать ссылку
              </Button>
              <Button
                variant="subtle"
                color="red"
                loading={revoke.isPending && revoke.variables === fresh.id}
                onClick={() => cancel(fresh.id)}
              >
                Отменить приглашение
              </Button>
            </Stack>
          </Paper>
        ) : (
          <Button
            size="md"
            leftSection={<IconUserPlus />}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Создать приглашение
          </Button>
        )}
        {create.error && <Alert color="red">{create.error.message}</Alert>}
        {revoke.error && <Alert color="red">{revoke.error.message}</Alert>}

        {waiting.filter((i) => i.id !== fresh?.id).length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Ждут регистрации
            </Text>
            {waiting
              .filter((i) => i.id !== fresh?.id)
              .map((i) => (
                <Group key={i.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" c="dimmed">
                    {i.createdAt && `создана ${fmt(i.createdAt)} · `}до{' '}
                    {fmt(i.expiresAt)}
                  </Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    style={{ flexShrink: 0 }}
                    color="red"
                    loading={revoke.isPending && revoke.variables === i.id}
                    onClick={() => cancel(i.id)}
                  >
                    Отменить
                  </Button>
                </Group>
              ))}
          </Stack>
        )}

        {joined.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Зарегистрировались
            </Text>
            {joined.map((i) => (
              <Group key={i.id} justify="space-between" wrap="nowrap">
                <Text size="sm">{i.usedBy!.fullName}</Text>
                <Badge variant="light" color="teal">
                  {i.usedBy!.login}
                </Badge>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
