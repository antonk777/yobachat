<template>
  <router-view />
</template>

<script setup lang="ts">
</script>

<style>
@import '@/styles/normalize.css';

:root {
  font-size: 4.75vw;

  --bg-color: #2a2a2a;
  --bg-color-dark: #1a1a1a;
  --text-color: #ffffff;
  --text-muted: #aaaaaa;
  --border-color: #3a3a3a;
  --primary-color: #4a9eff;
  --success-color: #2a5a2a;
  --error-color: #ff5555;
  --indicator-color: #666;
  --moderator-color: #e2c000;

  --line-height: 1.2rem;
  --spacing: .84rem;
  --whitespace: .45ch;
  --badge-size: 1.16rem;
  --emote-size: 1.58rem;
  --avatar-size: 1.58rem;

  --font-family: 'Futura PT', sans-serif;
  --font-family-condensed: 'Futura PT Condensed', sans-serif;
  --font-size: 1rem;
  --font-weight: 500;
  --font-size-small: .84rem;
}

body {
  overflow: hidden;
  background-color: var(--bg-color);
}

#app {
  width: 100%;
  height: 100dvh;
}
</style>
