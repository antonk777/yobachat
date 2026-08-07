<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useAuth } from '@/composables/useAuth';

const auth = useAuth();
const password = ref('');
const error = ref<string | null>(null);
const isLoading = ref(true);

onMounted(async () => {
  const { ok } = await auth.verifyToken();

  if (ok) {
    window.location.href = '/admin.html';
    return;
  }

  isLoading.value = false;
});

async function handleLogin() {
  if (!password.value) {
    error.value = 'Enter the admin password';
    return;
  }

  isLoading.value = true;
  error.value = null;

  const ok = await auth.loginWithPassword(password.value);

  if (ok) {
    window.location.href = '/admin.html';
    return;
  }

  error.value = 'Invalid password';
  isLoading.value = false;
}
</script>

<template>
  <div class="login-screen">
    <form class="login-content" @submit.prevent="handleLogin">
      <h1 class="login-title">yobachat</h1>
      <p class="login-description">Enter the admin password from your config</p>

      <div v-if="error" class="login-error">
        {{ error }}
      </div>

      <input
        v-model="password"
        class="login-input"
        type="password"
        name="password"
        autocomplete="current-password"
        placeholder="Admin password"
        :disabled="isLoading"
      >

      <button
        class="btn login-button"
        :class="isLoading ? 'btn-secondary' : 'btn-primary'"
        type="submit"
        :disabled="isLoading"
      >
        {{ isLoading ? 'Loading...' : 'Log in' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  background-color: var(--bg-color-dark);
  color: var(--text-color);
}

.login-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  text-align: center;
  padding: 2rem;
  max-width: 400px;
  width: 100%;
}

.login-title {
  font-size: 2rem;
  margin-bottom: 1rem;
  font-weight: 700;
}

.login-description {
  margin-bottom: 2rem;
  color: var(--text-muted);
}

.login-error {
  margin-bottom: 1rem;
  padding: 1rem;
  background-color: var(--error-color);
  color: white;
  border-radius: 0.25rem;
  font-size: 0.9rem;
}

.login-input {
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 1rem;
}

.login-input:disabled {
  opacity: 0.7;
}

.login-button {
  margin-inline: auto;
  padding: 1rem 2rem;
  font-size: 1.1rem;
  min-width: 200px;
  text-align: center;
}

.login-button:disabled {
  cursor: not-allowed;
  background-color: var(--bg-color-dark);
}
</style>
