<template>
  <div style="background: yellow; padding: 20px;">
    <h1>测试页面</h1>
    <p>如果你看到这个，说明路由正常工作</p>
    <el-button type="primary" @click="count++">点击次数: {{ count }}</el-button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const count = ref(0);
</script>
