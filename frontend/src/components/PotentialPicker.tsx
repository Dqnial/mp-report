import { Button, Group, Stack, Text } from '@mantine/core';
import type { Potential } from '../api/types';
import { POTENTIALS } from '../products';

/**
 * Низкий / Средний / Высокий. Повторное нажатие снимает выбор — потенциал
 * не обязателен (бывает, что его ещё не понять).
 */
export function PotentialPicker({
  value,
  onChange,
  description,
}: {
  value: Potential | null;
  onChange: (value: Potential | null) => void;
  description?: string;
}) {
  return (
    <Stack gap={6}>
      <div>
        <Text fw={500}>Потенциал</Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </div>
      <Group gap="xs" grow wrap="nowrap">
        {POTENTIALS.map((p) => (
          <Button
            key={p.value}
            size="md"
            // три кнопки в ряд на узком экране: без широких полей слова обрезаются
            px={4}
            variant={value === p.value ? 'filled' : 'default'}
            aria-pressed={value === p.value}
            onClick={() => onChange(value === p.value ? null : p.value)}
          >
            {p.label}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
