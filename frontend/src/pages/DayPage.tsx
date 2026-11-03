import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Collapse,
  Drawer,
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
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBuildingStore,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDotsVertical,
  IconPlus,
  IconSearch,
  IconStethoscope,
  IconTrash,
  IconUser,
} from '@tabler/icons-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useDayVisits,
  useDismissPlanned,
  usePlan,
  useRestorePlanned,
  useSyncStatus,
} from '../api/queries';
import type { DismissedDoctor, PlanGroup, PlannedDoctor } from '../api/types';
import { DockActions } from '../components/Layout';
import { SyncBadge, SyncIcon } from '../components/SyncBadge';
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

  const searchBar = useHideOnScrollDown();
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
          {isToday ? (
            <Text size="sm" c="dimmed">
              {formatDay(date)}
            </Text>
          ) : (
            <Button
              variant="light"
              size="compact-sm"
              radius="xl"
              mt={4}
              leftSection={<IconArrowBackUp size={16} />}
              onClick={() => go(todayIso())}
            >
              К сегодня
            </Button>
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

      {/* крупная «строка поиска» — ведёт на экран поиска с этим днём;
          рядом облако синхронизации, текст — только если что-то не так.
          Прилипает к верху: листаешь вниз — уезжает, потянул вверх — снова тут */}
      <div
        className={classes.searchBar}
        data-hidden={searchBar.hidden || undefined}
        data-floating={searchBar.floating || undefined}
      >
        <Group gap="xs" wrap="nowrap">
          <UnstyledButton
            component={Link}
            to={`/search?date=${date}`}
            className={classes.search}
          >
            <IconSearch size={20} />
            <Text c="dimmed">Поиск по визитам…</Text>
          </UnstyledButton>
          <SyncIcon />
        </Group>
        <SyncBadge problemsOnly />
      </div>

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

/**
 * Как адресная строка в Chrome: прокрутка вниз прячет, вверх — показывает.
 * Мелкие подёргивания пальца (до 8 px) не считаются; у самого верха — всегда видна.
 */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  // над карточками (не у самого верха) — с тенью, чтобы край не «резал» их
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setFloating(y > 120);
      if (y < 120) setHidden(false);
      else if (Math.abs(y - last) < 8) return;
      else setHidden(y > last);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return { hidden, floating };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const newVisitUrl = (date: string, g: PlanGroup, d?: PlannedDoctor) => {
  const q = new URLSearchParams({
    kind: g.kind,
    date,
    place: g.place,
    address: g.address,
    ...(d && { fullName: d.fullName, specialty: d.specialty, phone: d.phone }),
  });
  return `/visit/new?${q}`;
};

/**
 * План дня из шаблона: ЛПУ и сколько строк под ним. «+» открывает форму
 * с этим ЛПУ — название совпадёт с планом, и визит ляжет в его строки.
 * Если в плане вписаны врачи — они списком под ЛПУ: нажал — форма уже с ним.
 */
function PlanBlock({ date }: { date: string }) {
  const plan = usePlan(date);
  // для какого врача из плана открыто меню «визит / убрать»
  const [menuFor, setMenuFor] = useState<{
    doctor: PlannedDoctor;
    group: PlanGroup;
  } | null>(null);
  // свёрнут ли план — помним на телефоне (список визитов важнее)
  const [open, setOpen] = useLocalStorage({
    key: 'plan-open',
    defaultValue: true,
  });
  if (!plan.data) return null;
  const { hasTemplate, inTemplate, groups, stale, dismissed = [] } = plan.data;

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
              // группа задаёт цвет линии, которая ведёт от ЛПУ к его врачам
              <div
                key={g.row}
                className={classes.planGroup}
                style={
                  {
                    '--plan-line': `var(--mantine-color-${color}-4)`,
                  } as CSSProperties
                }
              >
                <Group
                  wrap="nowrap"
                  gap="xs"
                  className={classes.planRow}
                  data-doctors={g.doctors?.length ? '' : undefined}
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
                {(g.doctors ?? []).map((d) => (
                  <PlannedDoctorRow
                    key={d.row}
                    doctor={d}
                    color={color}
                    to={newVisitUrl(date, g, d)}
                    onMenu={() => setMenuFor({ doctor: d, group: g })}
                  />
                ))}
              </div>
            );
          })}
          <DismissedList date={date} doctors={dismissed} />
        </Stack>
      </Collapse>
      <PlannedDoctorSheet
        date={date}
        target={menuFor}
        onClose={() => setMenuFor(null)}
      />
    </Paper>
  );
}

/**
 * Врач из плана — под своим ЛПУ, линией от его значка. Был — зелёная
 * галочка, нет — вся строка открывает визит к нему.
 */
function PlannedDoctorRow({
  doctor: d,
  color,
  to,
  onMenu,
}: {
  doctor: PlannedDoctor;
  color: string;
  to: string;
  onMenu: () => void;
}) {
  const sub = [d.specialty, d.phone].filter(Boolean).join(' · ');
  const person = (
    <>
      <ThemeIcon
        size="md"
        radius="xl"
        variant={d.visited ? 'filled' : 'light'}
        color={d.visited ? 'green' : color}
        style={{ flexShrink: 0 }}
      >
        {d.visited ? <IconCheck size={16} /> : <IconUser size={16} />}
      </ThemeIcon>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text
          fw={500}
          c={d.visited ? 'dimmed' : undefined}
          td={d.visited ? 'line-through' : undefined}
          style={{ overflowWrap: 'anywhere' }}
        >
          {d.fullName}
        </Text>
        {sub && (
          <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            {sub}
          </Text>
        )}
      </Stack>
    </>
  );
  if (d.visited) {
    return (
      <div className={classes.planDoctor} aria-label={`Был: ${d.fullName}`}>
        <Group wrap="nowrap" gap="xs" className={classes.planDoctorCard}>
          {person}
        </Group>
      </div>
    );
  }
  return (
    <div className={classes.planDoctor}>
      <Group wrap="nowrap" gap={4} className={classes.planDoctorCard}>
        {/* вся карточка — визит к нему; «⋮» — визит или убрать из плана */}
        <UnstyledButton
          component={Link}
          to={to}
          className={classes.planDoctorLink}
          aria-label={`Визит к врачу: ${d.fullName}`}
        >
          {person}
          <ThemeIcon
            size="lg"
            radius="md"
            variant="light"
            color={color}
            style={{ flexShrink: 0 }}
          >
            <IconPlus size={20} />
          </ThemeIcon>
        </UnstyledButton>
        <ActionIcon
          size={40}
          variant="subtle"
          color="gray"
          radius="md"
          onClick={onMenu}
          style={{ flexShrink: 0 }}
          aria-label={`Ещё: ${d.fullName}`}
        >
          <IconDotsVertical size={22} />
        </ActionIcon>
      </Group>
    </div>
  );
}

/**
 * Меню врача из плана — снизу экрана, под большой палец: визит к нему или
 * убрать из плана. Убрать — только со вторым нажатием («Да, убрать»).
 */
function PlannedDoctorSheet({
  date,
  target,
  onClose,
}: {
  date: string;
  target: { doctor: PlannedDoctor; group: PlanGroup } | null;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const dismiss = useDismissPlanned(date);
  const restore = useRestorePlanned(date);
  // закрыли — в следующий раз снова с первого шага
  useEffect(() => {
    if (!target) setConfirm(false);
  }, [target]);
  const d = target?.doctor;
  const sub = d ? [d.specialty, d.phone].filter(Boolean).join(' · ') : '';

  const remove = () => {
    if (!d) return;
    const name = d.fullName;
    onClose();
    dismiss.mutate(d, {
      onSuccess: () => {
        const id = `dismissed-${date}-${name}`;
        notifications.show({
          id,
          color: 'gray',
          autoClose: 6000,
          message: (
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm">Убран из плана: {name}</Text>
              <Button
                size="compact-sm"
                variant="light"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  notifications.hide(id);
                  restore.mutate(name);
                }}
              >
                Вернуть
              </Button>
            </Group>
          ),
        });
      },
      onError: () =>
        notifications.show({
          color: 'red',
          message: `Не удалось убрать ${name} — нет связи с сервером. Попробуйте ещё раз.`,
        }),
    });
  };

  return (
    <Drawer
      opened={!!target}
      onClose={onClose}
      position="bottom"
      radius="lg"
      withCloseButton={false}
      // по высоте содержимого, а не на весь экран
      styles={{ content: { height: 'auto', maxHeight: '90dvh' } }}
    >
      {d && target && (
        <Stack gap="md" pb="sm">
          <div>
            <Text fw={700} size="lg" style={{ overflowWrap: 'anywhere' }}>
              {d.fullName}
            </Text>
            <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              {[sub, target.group.place].filter(Boolean).join(' · ')}
            </Text>
          </div>
          {confirm ? (
            <>
              <Text>
                Убрать из плана этого дня ({formatDay(date)})? Его не будет в
                плане, а его строка в отчёте останется пустой.
              </Text>
              <Text size="sm" c="dimmed">
                Вернуть можно внизу плана — «Убрано из плана».
              </Text>
              <Button
                size="lg"
                color="red"
                leftSection={<IconTrash size={20} />}
                onClick={remove}
              >
                Да, убрать
              </Button>
              <Button size="lg" variant="default" onClick={onClose}>
                Отмена
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                component={Link}
                to={newVisitUrl(date, target.group, d)}
                leftSection={<IconPlus size={20} />}
              >
                Добавить визит
              </Button>
              <Button
                size="lg"
                variant="light"
                color="red"
                leftSection={<IconTrash size={20} />}
                onClick={() => setConfirm(true)}
              >
                Убрать из плана
              </Button>
              <Button size="lg" variant="subtle" color="gray" onClick={onClose}>
                Закрыть
              </Button>
            </>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

/** Убранные из плана дня — свёрнутым списком внизу, чтобы вернуть. */
function DismissedList({
  date,
  doctors,
}: {
  date: string;
  doctors: DismissedDoctor[];
}) {
  const [open, setOpen] = useState(false);
  const restore = useRestorePlanned(date);
  if (!doctors.length) return null;
  return (
    <div className={classes.dismissed}>
      <UnstyledButton w="100%" onClick={() => setOpen(!open)} py={6} px={4}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Убрано из плана: {doctors.length}
          </Text>
          {open ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Stack gap={4} pb={4}>
          {doctors.map((d) => (
            <Group key={d.fullName} wrap="nowrap" gap="xs" px={4}>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                  {d.fullName}
                </Text>
                <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                  {[d.specialty, d.place].filter(Boolean).join(' · ')}
                </Text>
              </Stack>
              <Button
                variant="light"
                size="sm"
                leftSection={<IconArrowBackUp size={16} />}
                loading={restore.isPending && restore.variables === d.fullName}
                onClick={() => restore.mutate(d.fullName)}
                aria-label={`Вернуть в план: ${d.fullName}`}
              >
                Вернуть
              </Button>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </div>
  );
}
