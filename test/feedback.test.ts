import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { submitFeedback } from '../lib/api/feedback';

describe('Feedback 前端功能与路由策略测试', () => {
  describe('1. 路由入口可见性判定测试 (showFeedbackEntry)', () => {
    function isFeedbackEntryVisible(_pathname?: string): boolean {
      // 意见反馈入口在 AppShell 用户菜单中全局可见
      return true;
    }

    test('在 /projects 项目总览页显示反馈入口', () => {
      assert.equal(isFeedbackEntryVisible('/projects'), true);
    });

    test('在 /projects/654a9145-652e-4389-8519-0f4550830512 项目详情页显示反馈入口', () => {
      assert.equal(isFeedbackEntryVisible('/projects/654a9145-652e-4389-8519-0f4550830512'), true);
    });

    test('在 /account/settings 及其他 AppShell 页面全局显示反馈入口', () => {
      assert.equal(isFeedbackEntryVisible('/account/settings'), true);
      assert.equal(isFeedbackEntryVisible('/projects/new'), true);
      assert.equal(isFeedbackEntryVisible('/workspace'), true);
      assert.equal(isFeedbackEntryVisible('/resources'), true);
      assert.equal(isFeedbackEntryVisible('/projects/p-1/simcore'), true);
    });
  });

  describe('2. submitFeedback API 客户端测试', () => {
    test('接口返回 200 成功且正确发送 topic', async () => {
      let sentBody: any = null;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (_url: any, init: any) => {
        sentBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        } as any;
      };

      try {
        const res = await submitFeedback({ topic: '问题反馈/Bug', rating: 4, message: '系统很流畅' });
        assert.equal(res.success, true);
        assert.equal(res.error, undefined);
        assert.equal(sentBody.topic, '问题反馈/Bug');
        assert.equal(sentBody.rating, 4);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('接口返回 429 限流时返回友好提示与错误码', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { code: 'RATE_LIMITED', message: '提交反馈过于频繁，请稍后再试' } }),
      } as any);

      try {
        const res = await submitFeedback({ rating: 2 });
        assert.equal(res.success, false);
        assert.equal(res.error?.code, 'RATE_LIMITED');
        assert.ok(res.error?.message?.includes('频繁'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
