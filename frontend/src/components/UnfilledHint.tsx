import {
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { useDayVisits } from '../api/queries';
import { todayIso } from '../dates';
import { fieldName, missingFields, type MissingField } from '../visitFields';
import { VisitCard } from './VisitCard';

const ORDER: MissingField[] = [
  'fullName',
  'placeName',
  'phone',
  'address',
  'specialty',
  'products',
];

/**
 * Перед отправкой: что не заполнено в сегодняшних визитах. Не ошибка и не
 * блокирует отправку (врач мог не назвать имя) — просто чтобы медпред знал и мог
 * дописать. Визиты «из файла» не считаем: их заполняли в Excel до приложения.
 */
export function UnfilledHint() {
  const visits = useDayVisits(todayIso());
  const [open, setOpen] = useState(false);

  const own = (visits.data ?? []).filter((v) => !v.fromFile);
  const withGaps = own.filter((v) => missingFields(v).length > 0);
  if (!withGaps.length) return null;
  const counts = ORDER.map(
    (f) => [f, own.filter((v) => missingFields(v).includes(f)).length] as const,
  ).filter(([, n]) => n > 0);

  return (
    <Paper withBorder radius="md" p="sm" bg="gray.0">
      <Stack gap={6}>
        <Group gap={6} wrap="nowrap">
          <IconInfoCircle size={20} color="var(--mantine-color-gray-6)" />
          <Text fw={600}>Не заполнено за сегодня</Text>
        </Group>
        {/* по значку на поле: «нет ФИО · 1» — не разваливается при переносе */}
        <Group gap={6}>
          {counts.map(([f, n]) => (
            <Badge key={f} variant="light" color="gray" size="lg" tt="none">
              нет {fieldName(f)} · {n}
            </Badge>
          ))}
        </Group>
        <Text size="xs" c="dimmed">
          Отправить можно и так — это просто подсказка.
        </Text>
        <Button
          variant="light"
          color="gray"
          size="sm"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Скрыть' : `Показать визиты (${withGaps.length})`}
        </Button>
        <Collapse expanded={open}>
          <Stack gap="xs" pt={4}>
            {withGaps.map((v) => (
              <VisitCard key={v.clientId} visit={v} />
            ))}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}
