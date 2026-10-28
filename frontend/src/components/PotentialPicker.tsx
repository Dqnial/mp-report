import { Button, Group, Stack, Text } from '@mantine/core';
import type { Potential } from '../api/types';
import { POTENTIALS } from '../products';

/**
 * Низкий / Средний / Высокий — каждый своим цветом. Повторное нажатие
 * снимает выбор — потенциал не обязателен (бывает, что его ещё не понять).
 * compact — без подписи, мелкие кнопки (в списке справочника).
 */
export function PotentialPicker({
  value,
  onChange,
  description,
  compact,
  disabled,
}: {
  value: Potential | null;
  onChange: (value: Potential | null) => void;
  description?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const buttons = (
    <Group gap={compact ? 6 : 'xs'} grow wrap="nowrap">
      {POTENTIALS.map((p) => (
        <Button
          key={p.value}
          size={compact ? 'compact-sm' : 'md'}
          // три кнопки в ряд на узком экране: без широких полей слова обрезаются
          px={4}
          color={p.color}
          autoContrast
          // выбранный — залит цветом, остальные — серые с цветной подписью:
          // сразу видно, выбрано что-то или нет
          variant={value === p.value ? 'filled' : 'default'}
          c={value === p.value ? undefined : `${p.color}.8`}
          aria-pressed={value === p.value}
          disabled={disabled}
          onClick={() => onChange(value === p.value ? null : p.value)}
        >
          {p.label}
        </Button>
      ))}
    </Group>
  );
  if (compact) return buttons;
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
      {buttons}
    </Stack>
  );
}
