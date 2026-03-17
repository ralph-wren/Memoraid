// ============================================
// 定时任务后端 API 工具类
// 封装所有与后端定时任务相关的 API 调用
// ============================================

import { ScheduledTask, AppSettings } from './storage';

/**
 * 任务执行结果数据（用于邮件通知）
 */
export interface TaskExecutionResult {
  taskId: string;
  taskName: string;
  executionTime: number;
  status: 'success' | 'failed';
  articles: Array<{
    title: string;
    sourceUrl: string;
    platforms: string[];
    status: 'success' | 'failed';
    publishTime?: number;
    error?: string;
  }>;
  logs: Array<{
    time: number;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
  }>;
}

/**
 * 定时任务 API 客户端
 */
export class ScheduledTasksApi {
  private backendUrl: string;
  private anonymousId: string;

  constructor(settings: AppSettings) {
    this.backendUrl = settings.sync?.backendUrl || 'https://memoraid.dpdns.org';
    this.anonymousId = settings.anonymousId || '';
  }

  /**
   * 获取所有定时任务
   */
  async getTasks(): Promise<ScheduledTask[]> {
    const response = await fetch(`${this.backendUrl}/api/scheduled-tasks`, {
      headers: {
        'X-Anonymous-ID': this.anonymousId,
      },
    });

    if (!response.ok) {
      throw new Error(`获取任务失败: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data.tasks || [];
  }

  /**
   * 创建新任务
   */
  async createTask(task: ScheduledTask): Promise<void> {
    const response = await fetch(`${this.backendUrl}/api/scheduled-tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Anonymous-ID': this.anonymousId,
      },
      body: JSON.stringify(task),
    });

    if (!response.ok) {
      throw new Error(`创建任务失败: ${response.status} ${await response.text()}`);
    }
  }

  /**
   * 更新任务配置
   */
  async updateTask(task: ScheduledTask): Promise<void> {
    const response = await fetch(`${this.backendUrl}/api/scheduled-tasks/${task.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Anonymous-ID': this.anonymousId,
      },
      body: JSON.stringify(task),
    });

    if (!response.ok) {
      throw new Error(`更新任务失败: ${response.status} ${await response.text()}`);
    }
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.backendUrl}/api/scheduled-tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        'X-Anonymous-ID': this.anonymousId,
      },
    });

    if (!response.ok) {
      throw new Error(`删除任务失败: ${response.status} ${await response.text()}`);
    }
  }

  /**
   * 更新任务执行状态（供调度器使用）
   */
  async updateTaskStatus(
    taskId: string,
    status: 'success' | 'failed' | 'running',
    errorMessage?: string
  ): Promise<void> {
    const response = await fetch(`${this.backendUrl}/api/scheduled-tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Anonymous-ID': this.anonymousId,
      },
      body: JSON.stringify({
        lastRunTime: Date.now(),
        lastRunStatus: status,
        lastRunError: status === 'failed' ? (errorMessage || '未知错误') : null,
      }),
    });

    if (!response.ok) {
      throw new Error(`更新任务状态失败: ${response.status} ${await response.text()}`);
    }
  }

  /**
   * 发送任务完成通知邮件
   */
  async sendNotification(
    notificationEmail: string,
    executionResult: TaskExecutionResult
  ): Promise<void> {
    const response = await fetch(`${this.backendUrl}/api/scheduled-tasks/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Anonymous-ID': this.anonymousId,
      },
      body: JSON.stringify({
        notificationEmail,
        executionResult,
      }),
    });

    if (!response.ok) {
      throw new Error(`发送邮件通知失败: ${response.status} ${await response.text()}`);
    }
  }
}
