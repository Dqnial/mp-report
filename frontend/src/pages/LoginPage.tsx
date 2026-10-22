import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useLogin } from '../api/queries';

export function LoginPage() {
  const login = useLogin();
  const form = useForm({
    initialValues: { login: '', password: '' },
    validate: {
      login: (v) => (v.trim() ? null : 'Введите логин'),
      password: (v) => (v ? null : 'Введите пароль'),
    },
  });

  return (
    <Center mih="100dvh" p="md">
      <Paper w="100%" maw={400} p="lg" radius="lg" withBorder>
        <form onSubmit={form.onSubmit((v) => login.mutate(v))}>
          <Stack>
            <Title order={2}>Визиты МП</Title>
            <TextInput
              label="Логин"
              autoComplete="username"
              autoCapitalize="none"
              {...form.getInputProps('login')}
            />
            <PasswordInput
              label="Пароль"
              autoComplete="current-password"
              {...form.getInputProps('password')}
            />
            {login.error && <Alert color="red">{login.error.message}</Alert>}
            <Button type="submit" size="lg" loading={login.isPending}>
              Войти
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
