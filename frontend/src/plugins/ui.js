import {
  ElAside,
  ElAvatar,
  ElButton,
  ElCard,
  ElCol,
  ElContainer,
  ElDatePicker,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElHeader,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElOption,
  ElRow,
  ElSelect,
  ElSpace,
  ElSwitch,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  ElLoadingDirective,
} from 'element-plus';

import 'element-plus/es/components/avatar/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/card/style/css';
import 'element-plus/es/components/col/style/css';
import 'element-plus/es/components/container/style/css';
import 'element-plus/es/components/date-picker/style/css';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/drawer/style/css';
import 'element-plus/es/components/dropdown/style/css';
import 'element-plus/es/components/empty/style/css';
import 'element-plus/es/components/form/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/input-number/style/css';
import 'element-plus/es/components/loading/style/css';
import 'element-plus/es/components/menu/style/css';
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';
import 'element-plus/es/components/row/style/css';
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/space/style/css';
import 'element-plus/es/components/switch/style/css';
import 'element-plus/es/components/table/style/css';
import 'element-plus/es/components/tabs/style/css';
import 'element-plus/es/components/tag/style/css';

const elementComponents = {
  ElAside,
  ElAvatar,
  ElButton,
  ElCard,
  ElCol,
  ElContainer,
  ElDatePicker,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElHeader,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElOption,
  ElRow,
  ElSelect,
  ElSpace,
  ElSwitch,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
};

let appInstance;
let naiveReady;
let arcoReady;

function ensureAppInstance() {
  if (!appInstance) {
    throw new Error('UI app instance is not ready');
  }
  return appInstance;
}

function registerComponents(app, components) {
  Object.entries(components).forEach(([name, component]) => {
    app.component(name, component);
  });
}

export async function ensureNaiveUi() {
  if (naiveReady) return naiveReady;

  naiveReady = import('naive-ui').then((naive) => {
    const components = {
      NAlert: naive.NAlert,
      NAvatar: naive.NAvatar,
      NButton: naive.NButton,
      NButtonGroup: naive.NButtonGroup,
      NCard: naive.NCard,
      NCheckbox: naive.NCheckbox,
      NCheckboxGroup: naive.NCheckboxGroup,
      NCollapse: naive.NCollapse,
      NCollapseItem: naive.NCollapseItem,
      NCollapseTransition: naive.NCollapseTransition,
      NDataTable: naive.NDataTable,
      NDescriptions: naive.NDescriptions,
      NDescriptionsItem: naive.NDescriptionsItem,
      NDivider: naive.NDivider,
      NDrawer: naive.NDrawer,
      NDropdown: naive.NDropdown,
      NEmpty: naive.NEmpty,
      NForm: naive.NForm,
      NFormItem: naive.NFormItem,
      NGi: naive.NGi,
      NGrid: naive.NGrid,
      NGridItem: naive.NGridItem,
      NIcon: naive.NIcon,
      NInput: naive.NInput,
      NInputNumber: naive.NInputNumber,
      NModal: naive.NModal,
      NPagination: naive.NPagination,
      NPopover: naive.NPopover,
      NProgress: naive.NProgress,
      NRadio: naive.NRadio,
      NRadioButton: naive.NRadioButton,
      NRadioGroup: naive.NRadioGroup,
      NResult: naive.NResult,
      NSelect: naive.NSelect,
      NSpace: naive.NSpace,
      NSpin: naive.NSpin,
      NStatistic: naive.NStatistic,
      NSwitch: naive.NSwitch,
      NTabPane: naive.NTabPane,
      NTabs: naive.NTabs,
      NTag: naive.NTag,
      NText: naive.NText,
      NThing: naive.NThing,
      NTimePicker: naive.NTimePicker,
      NTooltip: naive.NTooltip,
      NUpload: naive.NUpload,
    };

    registerComponents(ensureAppInstance(), components);
  });

  return naiveReady;
}

export async function ensureArcoUi() {
  if (arcoReady) return arcoReady;

  arcoReady = Promise.all([
    import('@arco-design/web-vue'),
    import('@arco-design/web-vue/es/button/style/css.js'),
    import('@arco-design/web-vue/es/card/style/css.js'),
    import('@arco-design/web-vue/es/date-picker/style/css.js'),
    import('@arco-design/web-vue/es/form/style/css.js'),
    import('@arco-design/web-vue/es/input/style/css.js'),
    import('@arco-design/web-vue/es/list/style/css.js'),
    import('@arco-design/web-vue/es/modal/style/css.js'),
    import('@arco-design/web-vue/es/upload/style/css.js'),
  ]).then(([arco]) => {
    const components = {
      AButton: arco.Button,
      ACard: arco.Card,
      ADatePicker: arco.DatePicker,
      AForm: arco.Form,
      AFormItem: arco.FormItem,
      AInput: arco.Input,
      AList: arco.List,
      AListItem: arco.ListItem,
      AModal: arco.Modal,
      AUpload: arco.Upload,
    };

    registerComponents(ensureAppInstance(), components);
  });

  return arcoReady;
}

export async function ensureRouteUi(to) {
  const matched = to.matched || [];
  const needsNaive = matched.some((route) => route.meta?.requiresNaive);
  const needsArco = matched.some((route) => route.meta?.requiresArco);

  if (needsNaive) {
    await ensureNaiveUi();
  }

  if (needsArco) {
    await ensureArcoUi();
  }
}

export function registerUi(app) {
  appInstance = app;
  registerComponents(app, elementComponents);
  app.directive('loading', ElLoadingDirective);
}

export default registerUi;
