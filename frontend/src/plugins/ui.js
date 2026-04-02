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

function loadComponentModule(loader, pick) {
  return loader().then((mod) => pick(mod));
}

export async function ensureNaiveUi() {
  if (naiveReady) return naiveReady;

  naiveReady = Promise.all([
    loadComponentModule(() => import('naive-ui/es/alert'), (mod) => ({ NAlert: mod.NAlert })),
    loadComponentModule(() => import('naive-ui/es/avatar'), (mod) => ({ NAvatar: mod.NAvatar })),
    loadComponentModule(() => import('naive-ui/es/button'), (mod) => ({
      NButton: mod.NButton,
      NButtonGroup: mod.NButtonGroup,
    })),
    loadComponentModule(() => import('naive-ui/es/card'), (mod) => ({ NCard: mod.NCard })),
    loadComponentModule(() => import('naive-ui/es/checkbox'), (mod) => ({
      NCheckbox: mod.NCheckbox,
      NCheckboxGroup: mod.NCheckboxGroup,
    })),
    loadComponentModule(() => import('naive-ui/es/collapse'), (mod) => ({
      NCollapse: mod.NCollapse,
      NCollapseItem: mod.NCollapseItem,
    })),
    loadComponentModule(() => import('naive-ui/es/collapse-transition'), (mod) => ({
      NCollapseTransition: mod.NCollapseTransition,
    })),
    loadComponentModule(() => import('naive-ui/es/data-table'), (mod) => ({ NDataTable: mod.NDataTable })),
    loadComponentModule(() => import('naive-ui/es/descriptions'), (mod) => ({
      NDescriptions: mod.NDescriptions,
      NDescriptionsItem: mod.NDescriptionsItem,
    })),
    loadComponentModule(() => import('naive-ui/es/divider'), (mod) => ({ NDivider: mod.NDivider })),
    loadComponentModule(() => import('naive-ui/es/drawer'), (mod) => ({ NDrawer: mod.NDrawer })),
    loadComponentModule(() => import('naive-ui/es/dropdown'), (mod) => ({ NDropdown: mod.NDropdown })),
    loadComponentModule(() => import('naive-ui/es/empty'), (mod) => ({ NEmpty: mod.NEmpty })),
    loadComponentModule(() => import('naive-ui/es/form'), (mod) => ({
      NForm: mod.NForm,
      NFormItem: mod.NFormItem,
    })),
    loadComponentModule(() => import('naive-ui/es/grid'), (mod) => ({
      NGi: mod.NGi,
      NGrid: mod.NGrid,
      NGridItem: mod.NGridItem,
    })),
    loadComponentModule(() => import('naive-ui/es/icon'), (mod) => ({ NIcon: mod.NIcon })),
    loadComponentModule(() => import('naive-ui/es/input'), (mod) => ({ NInput: mod.NInput })),
    loadComponentModule(() => import('naive-ui/es/input-number'), (mod) => ({
      NInputNumber: mod.NInputNumber,
    })),
    loadComponentModule(() => import('naive-ui/es/modal'), (mod) => ({ NModal: mod.NModal })),
    loadComponentModule(() => import('naive-ui/es/pagination'), (mod) => ({
      NPagination: mod.NPagination,
    })),
    loadComponentModule(() => import('naive-ui/es/popover'), (mod) => ({ NPopover: mod.NPopover })),
    loadComponentModule(() => import('naive-ui/es/progress'), (mod) => ({ NProgress: mod.NProgress })),
    loadComponentModule(() => import('naive-ui/es/radio'), (mod) => ({
      NRadio: mod.NRadio,
      NRadioButton: mod.NRadioButton,
      NRadioGroup: mod.NRadioGroup,
    })),
    loadComponentModule(() => import('naive-ui/es/result'), (mod) => ({ NResult: mod.NResult })),
    loadComponentModule(() => import('naive-ui/es/select'), (mod) => ({ NSelect: mod.NSelect })),
    loadComponentModule(() => import('naive-ui/es/space'), (mod) => ({ NSpace: mod.NSpace })),
    loadComponentModule(() => import('naive-ui/es/spin'), (mod) => ({ NSpin: mod.NSpin })),
    loadComponentModule(() => import('naive-ui/es/statistic'), (mod) => ({
      NStatistic: mod.NStatistic,
    })),
    loadComponentModule(() => import('naive-ui/es/switch'), (mod) => ({ NSwitch: mod.NSwitch })),
    loadComponentModule(() => import('naive-ui/es/tabs'), (mod) => ({
      NTabPane: mod.NTabPane,
      NTabs: mod.NTabs,
    })),
    loadComponentModule(() => import('naive-ui/es/tag'), (mod) => ({ NTag: mod.NTag })),
    loadComponentModule(() => import('naive-ui/es/typography'), (mod) => ({ NText: mod.NText })),
    loadComponentModule(() => import('naive-ui/es/thing'), (mod) => ({ NThing: mod.NThing })),
    loadComponentModule(() => import('naive-ui/es/time-picker'), (mod) => ({
      NTimePicker: mod.NTimePicker,
    })),
    loadComponentModule(() => import('naive-ui/es/tooltip'), (mod) => ({ NTooltip: mod.NTooltip })),
    loadComponentModule(() => import('naive-ui/es/upload'), (mod) => ({ NUpload: mod.NUpload })),
  ]).then((modules) => {
    const components = {
      ...Object.assign({}, ...modules),
    };

    registerComponents(ensureAppInstance(), components);
  });

  return naiveReady;
}

export async function ensureArcoUi() {
  if (arcoReady) return arcoReady;

  arcoReady = Promise.all([
    import('@arco-design/web-vue/es/button'),
    import('@arco-design/web-vue/es/card'),
    import('@arco-design/web-vue/es/date-picker'),
    import('@arco-design/web-vue/es/form'),
    import('@arco-design/web-vue/es/input'),
    import('@arco-design/web-vue/es/list'),
    import('@arco-design/web-vue/es/modal'),
    import('@arco-design/web-vue/es/upload'),
    import('@arco-design/web-vue/es/button/style/css.js'),
    import('@arco-design/web-vue/es/card/style/css.js'),
    import('@arco-design/web-vue/es/date-picker/style/css.js'),
    import('@arco-design/web-vue/es/form/style/css.js'),
    import('@arco-design/web-vue/es/input/style/css.js'),
    import('@arco-design/web-vue/es/list/style/css.js'),
    import('@arco-design/web-vue/es/modal/style/css.js'),
    import('@arco-design/web-vue/es/upload/style/css.js'),
  ]).then(([button, card, datePicker, form, input, list, modal, upload]) => {
    const components = {
      AButton: button.default,
      ACard: card.default,
      ADatePicker: datePicker.default,
      AForm: form.default,
      AFormItem: form.FormItem,
      AInput: input.default,
      AList: list.default,
      AListItem: list.ListItem,
      AModal: modal.default,
      AUpload: upload.default,
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
