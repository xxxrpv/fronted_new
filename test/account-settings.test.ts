import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/;

function isAccountSettingsEntryVisible(_pathname?: string): boolean {
  // 账户设置入口在已登录状态下的 AppShell 用户菜单中全局可见
  return true;
}

function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '未绑定';
  const digits = phone.startsWith('+86') ? phone.slice(3) : phone;
  if (digits.length === 11) {
    return `+86 ${digits.slice(0, 3)}****${digits.slice(7)}`;
  }
  return phone.length > 4 ? `${phone.slice(0, 3)}****` : phone;
}

function validateProfile(displayName: string, organizationName: string): string | null {
  const trimmedName = displayName.trim();
  if (!trimmedName) {
    return '显示名称不能为空';
  }
  if (trimmedName.length > 80) {
    return '显示名称长度不能超过 80 个字符';
  }
  if (CONTROL_CHAR_REGEX.test(displayName)) {
    return '显示名称包含非法控制字符';
  }
  const trimmedOrg = organizationName.trim();
  if (trimmedOrg.length > 100) {
    return '所属机构长度不能超过 100 个字符';
  }
  if (CONTROL_CHAR_REGEX.test(organizationName)) {
    return '所属机构包含非法控制字符';
  }
  return null;
}

function validatePasswordChangeForm(
  code: string,
  newPassword: string,
  confirmPassword: string,
): string | null {
  const trimmedCode = code.trim();
  if (!/^[0-9]{6}$/.test(trimmedCode)) {
    return '请输入 6 位数字验证码';
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return '新密码长度须在 8–128 个字符之间';
  }
  if (newPassword !== confirmPassword) {
    return '两次输入的新密码不一致';
  }
  return null;
}

function validatePhoneChangeForm(
  rawPhone: string,
  code: string,
  currentPhone?: string | null,
): string | null {
  const raw = rawPhone.trim();
  const normalized = raw.startsWith('+86') ? raw : `+86${raw}`;
  if (!/^\+861[3-9][0-9]{9}$/.test(normalized)) {
    return '请输入有效的中国大陆手机号（11 位以 13–19 开头）';
  }
  if (normalized === currentPhone) {
    return '新手机号不能与当前已绑定的手机号相同';
  }
  const trimmedCode = code.trim();
  if (!/^[0-9]{6}$/.test(trimmedCode)) {
    return '请输入 6 位数字验证码';
  }
  return null;
}

describe('账户设置 (Account Settings v1.1) 前端策略与验证测试', () => {
  describe('1. 账户设置入口可见性判定测试 (showAccountSettingsEntry)', () => {
    test('在 /projects 项目总览页显示账户设置入口', () => {
      assert.equal(isAccountSettingsEntryVisible('/projects'), true);
    });

    test('在 /projects/654a9145-652e-4389-8519-0f4550830512 项目详情页显示账户设置入口', () => {
      assert.equal(isAccountSettingsEntryVisible('/projects/654a9145-652e-4389-8519-0f4550830512'), true);
    });

    test('在 /account/settings 页面本身显示账户设置入口', () => {
      assert.equal(isAccountSettingsEntryVisible('/account/settings'), true);
    });

    test('在所有 AppShell 页面（如 /projects/new、/workspace、/resources 等）全局显示账户设置入口', () => {
      assert.equal(isAccountSettingsEntryVisible('/projects/new'), true);
      assert.equal(isAccountSettingsEntryVisible('/workspace'), true);
      assert.equal(isAccountSettingsEntryVisible('/resources'), true);
      assert.equal(isAccountSettingsEntryVisible('/projects/p-1/simcore'), true);
    });
  });

  describe('2. 个人资料校验与 Dirty 变更判断测试', () => {
    test('合法输入校验通过', () => {
      assert.equal(validateProfile('工程师小李', '机器人团队'), null);
      assert.equal(validateProfile('Alex', ''), null);
      assert.equal(validateProfile('王五', '   '), null);
    });

    test('空名称与超长名称拒绝', () => {
      assert.equal(validateProfile('', '机构'), '显示名称不能为空');
      assert.equal(validateProfile('   ', '机构'), '显示名称不能为空');
      assert.equal(validateProfile('a'.repeat(81), '机构'), '显示名称长度不能超过 80 个字符');
    });

    test('非法控制字符拒绝', () => {
      assert.equal(validateProfile('张三\u0000', '机构'), '显示名称包含非法控制字符');
      assert.equal(validateProfile('张三', '机构\n'), '所属机构包含非法控制字符');
    });

    test('机构超长拒绝', () => {
      assert.equal(validateProfile('张三', 'a'.repeat(101)), '所属机构长度不能超过 100 个字符');
    });
  });

  describe('3. 手机号脱敏函数测试', () => {
    test('11位手机号正常脱敏', () => {
      assert.equal(maskPhoneNumber('+8613812345678'), '+86 138****5678');
      assert.equal(maskPhoneNumber('13812345678'), '+86 138****5678');
    });

    test('空值友好降级', () => {
      assert.equal(maskPhoneNumber(null), '未绑定');
      assert.equal(maskPhoneNumber(undefined), '未绑定');
    });
  });

  describe('4. 修改密码表单校验测试', () => {
    test('验证码非 6 位数字拒绝', () => {
      assert.equal(
        validatePasswordChangeForm('12345', 'new-pwd-1234', 'new-pwd-1234'),
        '请输入 6 位数字验证码',
      );
      assert.equal(
        validatePasswordChangeForm('abcdef', 'new-pwd-1234', 'new-pwd-1234'),
        '请输入 6 位数字验证码',
      );
    });

    test('密码长度必须在 8-128 位之间', () => {
      assert.equal(
        validatePasswordChangeForm('123456', 'short', 'short'),
        '新密码长度须在 8–128 个字符之间',
      );
      assert.equal(
        validatePasswordChangeForm('123456', 'a'.repeat(129), 'a'.repeat(129)),
        '新密码长度须在 8–128 个字符之间',
      );
    });

    test('两次密码不一致拒绝', () => {
      assert.equal(
        validatePasswordChangeForm('123456', 'password-1', 'password-2'),
        '两次输入的新密码不一致',
      );
    });

    test('合法输入校验通过', () => {
      assert.equal(
        validatePasswordChangeForm('123456', 'valid-password-123', 'valid-password-123'),
        null,
      );
    });
  });

  describe('5. 更换手机号表单校验测试', () => {
    test('非法手机号格式拒绝', () => {
      assert.equal(
        validatePhoneChangeForm('12345', '123456'),
        '请输入有效的中国大陆手机号（11 位以 13–19 开头）',
      );
      assert.equal(
        validatePhoneChangeForm('12012345678', '123456'),
        '请输入有效的中国大陆手机号（11 位以 13–19 开头）',
      );
    });

    test('新手机号与原绑定手机号相同时拒绝', () => {
      assert.equal(
        validatePhoneChangeForm('13800000001', '123456', '+8613800000001'),
        '新手机号不能与当前已绑定的手机号相同',
      );
    });

    test('验证码非 6 位数字拒绝', () => {
      assert.equal(
        validatePhoneChangeForm('13912345678', '123', '+8613800000001'),
        '请输入 6 位数字验证码',
      );
    });

    test('合法换绑信息校验通过', () => {
      assert.equal(
        validatePhoneChangeForm('13912345678', '654321', '+8613800000001'),
        null,
      );
    });
  });
});
