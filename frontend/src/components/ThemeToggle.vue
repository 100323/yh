<template>
  <el-switch
    v-model="isDark"
    size="small"
    inline-prompt
    active-text="暗"
    inactive-text="亮"
    @change="toggleTheme"
  />
</template>

<script setup>
import { ref, onMounted } from 'vue';

const isDark = ref(false);

onMounted(() => {
  const savedTheme = localStorage.getItem('theme');
  isDark.value = savedTheme === 'dark';
  applyTheme(isDark.value);
});

const toggleTheme = (dark) => {
  applyTheme(dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
};

const applyTheme = (dark) => {
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};
</script>
