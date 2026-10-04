/**
 * 将Canvas导出为图片并触发浏览器内部下载。
 *
 * 明确不调用 navigator.share —— 该 API 会弹出系统共享面板，
 * 与「点导出即下载到本地」的产品预期不符。
 *
 * @param {HTMLCanvasElement} canvas - canvas元素
 * @param {string} filename - 文件名
 */
export const downloadCanvasAsImage = (canvas, filename) => {
  try {
    // 优先使用 toBlob：处理大图更高效、更不易崩溃
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) {
          console.error('Canvas转换Blob失败，回退DataURL');
          fallbackToDataURL(canvas, filename);
          return;
        }
        downloadBlob(blob, filename);
      }, 'image/png');
    } else {
      fallbackToDataURL(canvas, filename);
    }
  } catch (e) {
    console.error('导出图片出错:', e);
    fallbackToDataURL(canvas, filename);
  }
};

/**
 * 通过 <a download> 触发浏览器原生下载（不弹共享面板）。
 */
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  // 某些移动端浏览器要求元素在文档中才可点击
  document.body.appendChild(link);

  try {
    link.click();
  } catch (e) {
    console.error('Link click failed', e);
    // 极端情况下 click 失败，尝试 dataURL 兜底
    fallbackToDataURLFromBlob(blob, filename);
  }

  document.body.removeChild(link);
  // 稍后释放，给下载留出时间
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * 兜底：canvas.toDataURL + <a download>
 */
const fallbackToDataURL = (canvas, filename) => {
  try {
    const imgUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = imgUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('DataURL导出失败:', e);
    alert('导出图片失败，图片可能过大');
  }
};

/**
 * 兜底：把 Blob 读成 dataURL 再下载
 */
const fallbackToDataURLFromBlob = (blob, filename) => {
  try {
    const reader = new FileReader();
    reader.onload = () => {
      const link = document.createElement('a');
      link.href = reader.result;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    reader.onerror = () => alert('导出图片失败');
    reader.readAsDataURL(blob);
  } catch (e) {
    console.error('Blob兜底下载失败:', e);
    alert('导出图片失败');
  }
};

/**
 * 通用 Blob 下载（供非 canvas 场景复用）
 * @param {Blob} blob
 * @param {string} filename
 */
export const downloadBlobFile = (blob, filename) => {
  downloadBlob(blob, filename);
};
