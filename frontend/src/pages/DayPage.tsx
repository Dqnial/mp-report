import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconPlus,
  IconSearch,
  IconStethoscope,
} from '@tabler/icons-react';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDayVisits, usePlan, useSyncStatus } from '../api/queries';
import type { PlanGroup } from '../api/types';
import { DockActions } from '../components/Layout';
import { SyncBadge } from '../components/SyncBadge';
import { VisitCard } from '../components/VisitCard';
import { formatDay, monthOf, shiftWorkday, todayIso } from '../dates';
import { ensureMonth } from '../offline/sync';
import classes from './DayPage.module.css';

export function DayPage() {
  const params = useParams();
  const date = params.date ?? todayIso();
  const isToday = date === todayIso();
  const navigate = useNavigate();
  const visits = useDayVisits(date);
  const sync = useSyncStatus();
  const month = monthOf(date);

  // визиты месяца — с сервера, если в этот запуск их ещё не брали
  // (первый вход на телефоне, листание на другой месяц)
  useEffect(() => {
    void ensureMonth(month);
  }, [month]);
  // пустой список, пока месяц ещё грузится, — это «загружаю», а не «нет визитов»
  const loadingMonth =
    sync.pulling.includes(month) ||
    (!sync.pulled.includes(month) && !sync.offline);

  const go = (iso: string) =>
    navigate(iso === todayIso() ? '/' : `/day/${iso}`, { replace: true });

  const list = visits.data ?? [];
  const doctors = list.filter((v) => v.kind === 'DOCTOR').length;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="xl"
          aria-label="Предыдущий день"
          onClick={() => go(shiftWorkday(date, -1))}
        >
          <IconChevronLeft size={28} />
        </ActionIcon>
        <Stack gap={0} align="center">
          <Title order={3} ta="center">
            {isToday ? 'Сегодня' : capitalize(formatDay(date))}
          </Title>
          {isToday && (
            <Text size="sm" c="dimmed">
              {formatDay(date)}
            </Text>
          )}
        </Stack>
        <ActionIcon
          variant="subtle"
          size="xl"
          aria-label="Следующий день"
          onClick={() => go(shiftWorkday(date, 1))}
        >
          <IconChevronRight size={28} />
        </ActionIcon>
      </Group>

      {/* крупная «строка поиска» — ведёт на экран поиска с этим днём */}
      <UnstyledButton
        component={Link}
        to={`/search?date=${date}`}
        className={classes.search}
      >
        <IconSearch size={20} />
        <Text c="dimmed">Поиск по визитам…</Text>
      </UnstyledButton>

      <SyncBadge />

      {!isToday && (
        <Button variant="subtle" size="xs" onClick={() => go(todayIso())}>
          Вернуться к сегодня
        </Button>
      )}

      <PlanBlock date={date} />

      {list.length > 0 && (
        <Text c="dimmed" size="sm" ta="center">
          Визитов: {list.length} · врачи {doctors} · аптеки{' '}
          {list.length - doctors}
        </Text>
      )}

      {visits.isPending || (list.length === 0 && loadingMonth) ? (
        <Stack align="center" gap="xs" py="xl">
          <Loader />
          <Text c="dimmed" size="sm">
            Загружаю визиты…
          </Text>
        </Stack>
      ) : visits.isError ? (
        <Alert color="red">{visits.error.message}</Alert>
      ) : list.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Визитов пока нет
        </Text>
      ) : (
        list.map((v, i) => <VisitCard key={v.id} visit={v} n={i + 1} />)
      )}

      <DockActions>
        {/* узкие боковые поля: на 320 px и крупном шрифте надпись не обрезается */}
        <Group grow gap="sm" className={classes.add}>
          <Button
            component={Link}
            to={`/visit/new?kind=DOCTOR&date=${date}`}
            size="xl"
            leftSection={<IconStethoscope />}
          >
            Врач
          </Button>
          <Button
            component={Link}
            to={`/visit/new?kind=PHARMACY&date=${date}`}
            size="xl"
            color="teal"
            leftSection={<IconBuildingStore />}
          >
            Аптека
          </Button>
        </Group>
      </DockActions>
    </Stack>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const newVisitUrl = (date: string, g: PlanGroup) => {
  const q = new URLSearchParams({
    kind: g.kind,
    date,
    place: g.place,
    address: g.address,
  });
  return `/visit/new?${q}`;
};

/**
 * План дня из шаблона: ЛПУ и сколько строк под ним. «+» открывает форму
 * с этим ЛПУ — название совпадёт с планом, и визит ляжет в его строки.
 */
function PlanBlock({ date }: { date: string }) {
  const plan = usePlan(date);
  // свёрнут ли план — помним на телефоне (список визитов важнее)
  const [open, setOpen] = useLocalStorage({
    key: 'plan-open',
    defaultValue: true,
  });
  if (!plan.data) return null;
  const { hasTemplate, inTemplate, groups, stale } = plan.data;

  if (!hasTemplate) {
    return (
      <Text size="sm" c="dimmed" ta="center">
        Шаблон на этот месяц не загружен — <Link to="/report">загрузить</Link>
      </Text>
    );
  }
  if (!inTemplate) {
    return (
      <Alert color="orange" icon={<IconAlertTriangle />}>
        Этого дня нет в шаблоне — визиты за него не попадут в отчёт.
      </Alert>
    );
  }
  if (!groups.length) return null;
  const visited = groups.filter((g) => g.used > 0).length;

  return (
    <Paper withBorder radius="md" p="xs">
      <UnstyledButton w="100%" onClick={() => setOpen(!open)}>
        <Group justify="space-between" px={4} pb={open ? 4 : 0} wrap="nowrap">
          <div>
            <Text fw={600}>
              По плану{' '}
              <Text span c="dimmed" fw={400} size="sm">
                · был в {visited} из {groups.length}
              </Text>
            </Text>
            {stale && (
              <Text size="xs" c="dimmed">
                без сети — счётчики обновятся, когда появится связь
              </Text>
            )}
          </div>
          {open ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Stack gap={0}>
          {groups.map((g) => {
            // у мест не по плану «ёмкость» — просто запасные строки дня, не план
            const done = g.inFile && g.used >= g.capacity;
            // цвета — как у больших кнопок внизу: врач бирюзовый, аптека зелёная
            const color = g.kind === 'PHARMACY' ? 'teal' : 'cyan';
            return (
              <Group
                key={g.row}
                wrap="nowrap"
                gap="xs"
                className={classes.planRow}
              >
                <ThemeIcon
                  size="lg"
                  radius="xl"
                  variant="light"
                  color={color}
                  aria-label={g.kind === 'PHARMACY' ? 'Аптека' : 'Врач'}
                >
                  {g.kind === 'PHARMACY' ? (
                    <IconBuildingStore size={20} />
                  ) : (
                    <IconStethoscope size={20} />
                  )}
                </ThemeIcon>
                {/* название и адрес — целиком, с переносом: по ним ищут место */}
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ overflowWrap: 'anywhere' }}>{g.place}</Text>
                  {!g.inFile && (
                    <Text size="xs" c="orange.8">
                      не по плану
                    </Text>
                  )}
                  {g.address && (
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {g.address}
                    </Text>
                  )}
                </Stack>
                <Badge
                  variant={done ? 'filled' : 'light'}
                  color={done ? 'green' : 'gray'}
                  leftSection={done ? <IconCheck size={12} /> : undefined}
                  style={{ flexShrink: 0 }}
                >
                  {g.inFile ? `${g.used}/${g.capacity}` : g.used}
                </Badge>
                <ActionIcon
                  component={Link}
                  to={newVisitUrl(date, g)}
                  size="xl"
                  variant="light"
                  color={color}
                  style={{ flexShrink: 0 }}
                  aria-label={`Визит: ${g.place}`}
                >
                  <IconPlus />
                </ActionIcon>
              </Group>
            );
          })}
        </Stack>
      </Collapse>
    </Paper>
  );
}
