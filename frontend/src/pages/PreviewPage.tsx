import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  List,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconLock,
} from '@tabler/icons-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePreview, useSyncStatus, useTemplates } from '../api/queries';
import type { PreviewRow } from '../api/types';
import { SyncBadge } from '../components/SyncBadge';
import { formatDay, monthOf, shiftWorkday, todayIso } from '../dates';
import { unsentChanges } from '../plural';
import classes from './PreviewPage.module.css';

/**
 * Предпросмотр отчёта: строки выбранного дня ровно так, как они лягут в Excel
 * (считает сервер тем же кодом, что собирает файл). Чтобы не отправлять отчёт
 * себе ради проверки.
 */
export function PreviewPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayIso();
  const navigate = useNavigate();
  const sync = useSyncStatus();
  const templates = useTemplates();
  const hasTemplate = !!templates.data?.some((t) => t.month === monthOf(date));
  const preview = usePreview(date, hasTemplate);

  const go = (iso: string) => setParams({ date: iso }, { replace: true });
  const rows = preview.data?.rows ?? [];
  const app = rows.filter((r) => r.source === 'app').length;
  const file = rows.filter((r) => r.source === 'file').length;
  const added = rows.filter((r) => r.added).length;
  const free = rows.filter((r) => r.source === 'empty').length;

  return (
    <Stack gap="sm">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="xl"
          aria-label="Назад к отчёту"
          onClick={() => navigate('/report')}
        >
          <IconArrowLeft size={26} />
        </ActionIcon>
        <Title order={3}>Предпросмотр отчёта</Title>
      </Group>

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
          <Text fw={700} size="lg">
            {date === todayIso() ? 'Сегодня' : capitalize(formatDay(date))}
          </Text>
          {date === todayIso() && (
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

      <SyncBadge />

      {sync.pending > 0 && (
        <Alert color="orange" icon={<IconAlertTriangle />}>
          На телефоне {unsentChanges(sync.pending)} — здесь их пока нет: файл
          собирает сервер. Появятся, как только уйдут.
        </Alert>
      )}

      {templates.isPending || (hasTemplate && preview.isPending) ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : !hasTemplate ? (
        <Text c="dimmed" ta="center" py="xl">
          Шаблон на этот месяц не загружен — <Link to="/report">загрузить</Link>
        </Text>
      ) : preview.isError ? (
        <Alert color="gray" icon={<IconAlertTriangle />}>
          Нет связи с сервером — предпросмотр собирается на сервере, как и сам
          отчёт.
        </Alert>
      ) : !preview.data?.inTemplate ? (
        <Text c="dimmed" ta="center" py="xl">
          Этого дня нет в шаблоне.
        </Text>
      ) : (
        <>
          <Text size="sm" c="dimmed" ta="center">
            Строк за день: {rows.length} · из приложения {app} · из файла {file}{' '}
            · свободно {free}
            {added > 0 && ` · добавлено ${added}`}
          </Text>
          {preview.data.warnings.length > 0 && (
            <Alert color="orange" icon={<IconAlertTriangle />}>
              <List size="sm" spacing={4}>
                {preview.data.warnings.map((w) => (
                  <List.Item key={w}>{w}</List.Item>
                ))}
              </List>
            </Alert>
          )}
          <Stack gap={6} style={{ opacity: preview.isFetching ? 0.6 : 1 }}>
            {groupFree(rows).map((item) =>
              Array.isArray(item) ? (
                <FreeRows key={item[0].row} rows={item} />
              ) : (
                <RowCard key={item.row} r={item} />
              ),
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Подряд идущие пустые строки «там же» — одной строкой, чтобы не листать. */
function groupFree(rows: PreviewRow[]) {
  const out: (PreviewRow | PreviewRow[])[] = [];
  for (const r of rows) {
    const plainFree = r.source === 'empty' && !r.cells.E;
    const prev = out[out.length - 1];
    if (plainFree && Array.isArray(prev)) prev.push(r);
    else out.push(plainFree ? [r] : r);
  }
  return out;
}

function FreeRows({ rows }: { rows: PreviewRow[] }) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return (
    <Text size="sm" c="dimmed" px="sm">
      {rows.length === 1
        ? `свободная строка (${first.row})`
        : `свободно строк: ${rows.length} (${first.row}–${last.row})`}
    </Text>
  );
}

function RowCard({ r }: { r: PreviewRow }) {
  const c = r.cells;
  const details = [c.H, c.I].filter(Boolean).join(' · ');
  const products = [c.J, c.K, c.L, c.M].filter(Boolean).join(', ');
  const body = (
    <Paper
      withBorder
      radius="md"
      p="xs"
      className={classes.row}
      data-source={r.source}
    >
      <Stack gap={2}>
        <Group gap={6} justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <Text fw={700} size="sm" c="dimmed">
              {r.num ? `№ ${r.num}` : '—'}
            </Text>
            {r.label && (
              <Text size="sm" c="dimmed">
                · {r.label}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              стр. {r.row}
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            {r.added && (
              <Badge color="orange" variant="light" tt="none">
                добавлена
              </Badge>
            )}
            {r.source === 'app' && (
              <Badge color="teal" variant="light" tt="none">
                из приложения
              </Badge>
            )}
            {r.source === 'file' && (
              <Badge
                color="gray"
                variant="light"
                tt="none"
                leftSection={<IconLock size={12} />}
              >
                из файла
              </Badge>
            )}
          </Group>
        </Group>

        {c.E ? (
          <Text fw={600} className={classes.text}>
            {c.E}
            {c.F && (
              <Text span c="dimmed" fw={400} size="sm">
                {' '}
                · {c.F}
              </Text>
            )}
          </Text>
        ) : (
          r.source !== 'empty' && (
            <Text size="sm" c="dimmed">
              ↳ там же
            </Text>
          )
        )}
        {r.source === 'empty' ? (
          <Text size="sm" c="dimmed" fs="italic">
            по плану, свободно
          </Text>
        ) : (
          <>
            {/* ФИО отдельно: пустое — «нет ФИО», даже если специальность есть */}
            <Text size="sm" className={classes.text}>
              {c.G ? (
                <Text span fw={600} size="sm">
                  {c.G}
                </Text>
              ) : (
                <span className={classes.missing}>нет ФИО</span>
              )}
              {details && ` · ${details}`}
            </Text>
            {products && <Text size="sm">{products}</Text>}
            {c.N && (
              <Text size="sm" c="dimmed" className={classes.text}>
                {c.N}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
  return r.visitId ? (
    <Link
      to={`/visit/${encodeURIComponent(r.visitId)}`}
      className={classes.link}
    >
      {body}
    </Link>
  ) : (
    body
  );
}
