import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import * as rules from '../lib/deploy/deployx-state';
import type {
  DeployxValidationReportItem,
  LocalCapabilities,
  PreparationOperation,
} from '../lib/api';

describe('Task-037 DeployX RC4 Frontend Unit Tests', () => {
  test('1. LocalCapabilities decisions drive preparation controls accurately', () => {
    const disabledCaps: LocalCapabilities = {
      projectId: 'proj-1',
      environmentKey: 'test',
      observedAt: '2026-10-29T12:00:00Z',
      target: {},
      decisions: {
        RESOURCE_LIST: false,
        ROBOT_STATUS: false,
        PACKAGE_DETAIL: false,
        PACKAGE_MANIFEST: false,
        PACKAGE_REPORTS: false,
        PATH_CHECK: false,
        UPLOAD_PACKAGE: false,
        UPLOAD_MODEL: false,
        UNPACK: false,
        VALIDATE_STAGE1: false,
        VALIDATE_STAGE2: false,
        BIND: false,
        PREPARE: false,
        CREATE_DEPLOYMENT: false,
        BUILD_RELEASE: false,
        DEPLOY_TO_ROBOT: false,
        TASK_READ: false,
        TASK_LIST: false,
        LOGS: false,
        STOP: false,
        CANCEL: false,
        RECOVER: false,
      },
    };

    const ctrlDisabled = rules.preparationControls(disabledCaps, null, false);
    assert.equal(ctrlDisabled.uploadPackage, false);
    assert.equal(ctrlDisabled.uploadModel, false);
    assert.equal(ctrlDisabled.unpack, false);
    assert.equal(ctrlDisabled.validateStage1, false);
    assert.equal(ctrlDisabled.validateStage2, false);
    assert.equal(ctrlDisabled.bind, false);
    assert.equal(ctrlDisabled.prepare, false);

    const enabledCaps: LocalCapabilities = {
      projectId: 'proj-1',
      environmentKey: 'test',
      observedAt: '2026-10-29T12:00:00Z',
      target: {},
      decisions: {
        RESOURCE_LIST: true,
        ROBOT_STATUS: true,
        PACKAGE_DETAIL: true,
        PACKAGE_MANIFEST: true,
        PACKAGE_REPORTS: true,
        PATH_CHECK: true,
        UPLOAD_PACKAGE: true,
        UPLOAD_MODEL: true,
        UNPACK: true,
        VALIDATE_STAGE1: true,
        VALIDATE_STAGE2: true,
        BIND: true,
        PREPARE: true,
        CREATE_DEPLOYMENT: true,
        BUILD_RELEASE: true,
        DEPLOY_TO_ROBOT: true,
        TASK_READ: true,
        TASK_LIST: true,
        LOGS: true,
        STOP: true,
        CANCEL: true,
        RECOVER: true,
      },
    };

    const ctrlEnabled = rules.preparationControls(enabledCaps, null, false);
    assert.equal(ctrlEnabled.uploadPackage, true);
    assert.equal(ctrlEnabled.uploadModel, true);
    assert.equal(ctrlEnabled.unpack, true);
    assert.equal(ctrlEnabled.validateStage1, true);
    assert.equal(ctrlEnabled.validateStage2, true);
    assert.equal(ctrlEnabled.bind, false); // No trusted binding record source is available.
    assert.equal(ctrlEnabled.prepare, true);

    // Busy state disables all preparation controls
    const ctrlBusy = rules.preparationControls(enabledCaps, null, true);
    assert.equal(ctrlBusy.uploadPackage, false);
    assert.equal(ctrlBusy.unpack, false);
    assert.equal(ctrlBusy.bind, false);
  });

  test('2. Stage 2 Validation strictly matches packageId, robotId and stage2', () => {
    const reports: DeployxValidationReportItem[] = [
      {
        id: 'rep-1',
        stage: 'stage1',
        status: 'PASSED',
        passedBlock: true,
        packageId: 'pkg-1',
        issues: [],
        checkedRules: [],
        createdAt: '2026-10-29T12:00:00Z',
      },
      {
        id: 'rep-2',
        stage: 'stage2',
        status: 'PASSED',
        passedBlock: true,
        packageId: 'pkg-1',
        robotId: 'robot-alpha',
        issues: [],
        checkedRules: [],
        createdAt: '2026-10-29T12:00:00Z',
      },
      {
        id: 'rep-3',
        stage: 'stage2',
        status: 'FAILED',
        passedBlock: false,
        packageId: 'pkg-1',
        robotId: 'robot-beta',
        issues: [{ id: 'iss-1', severity: 'BLOCKER', reason: 'Mismatch' }],
        checkedRules: [],
        createdAt: '2026-10-29T12:00:00Z',
      },
    ];

    // Correct package + correct robot -> true
    assert.equal(rules.stage2ValidationPassed(reports, 'pkg-1', 'robot-alpha'), true);

    // Mismatched robot -> false
    assert.equal(rules.stage2ValidationPassed(reports, 'pkg-1', 'robot-beta'), false);
    assert.equal(rules.stage2ValidationPassed(reports, 'pkg-1', 'robot-gamma'), false);

    // Mismatched package -> false
    assert.equal(rules.stage2ValidationPassed(reports, 'pkg-2', 'robot-alpha'), false);

    // Null/undefined params -> false
    assert.equal(rules.stage2ValidationPassed(reports, null, 'robot-alpha'), false);
    assert.equal(rules.stage2ValidationPassed(reports, 'pkg-1', null), false);
  });

  test('3. Package step status correctly reflects unpacking and unpack failure', () => {
    assert.equal(rules.packageStepStatus(null), 'PENDING');
    assert.equal(rules.packageStepStatus({ id: 'p', originalName: 'p.zip', sha256: 'a', sizeBytes: 10, status: 'UNPACKING', createdAt: '', updatedAt: '' }), 'RUNNING');
    assert.equal(rules.packageStepStatus({ id: 'p', originalName: 'p.zip', sha256: 'a', sizeBytes: 10, status: 'UNPACKED', createdAt: '', updatedAt: '' }), 'SUCCEEDED');
    assert.equal(rules.packageStepStatus({ id: 'p', originalName: 'p.zip', sha256: 'a', sizeBytes: 10, status: 'UNPACK_FAILED', createdAt: '', updatedAt: '' }), 'FAILED');
    assert.equal(rules.packageStepStatus({ id: 'p', originalName: 'p.zip', sha256: 'a', sizeBytes: 10, status: 'REJECTED', createdAt: '', updatedAt: '' }), 'FAILED');
  });

  test('4. Preparation operations SUBMITTED is pending/accepted but not business terminal', () => {
    const opSubmitted: PreparationOperation = {
      operationId: 'op-1',
      operationType: 'UNPACK',
      submitStatus: 'SUBMITTED',
      environmentKey: 'test',
      projectId: 'proj-1',
      resourceId: null,
      observedAt: '2026-10-29T12:00:00Z',
    };

    assert.equal(opSubmitted.submitStatus, 'SUBMITTED');
    // Operation is submitted, but not finished until authoritative entity updates
    assert.equal(rules.isPending(opSubmitted.submitStatus), false); // SUBMITTED is received by platform, not UNKNOWN_SUBMIT or PENDING_SUBMIT

    const opUnknown: PreparationOperation = {
      operationId: 'op-2',
      operationType: 'UPLOAD_PACKAGE',
      submitStatus: 'UNKNOWN_SUBMIT',
      environmentKey: 'test',
      projectId: 'proj-1',
      resourceId: null,
      observedAt: null,
    };
    assert.equal(rules.isPending(opUnknown.submitStatus), true);
  });
});
