import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

import { TAG_NONE, TAG_OPTIONS } from '../data'
import type { MaterialResource, ResourceTag } from '../types'
import { useCreateResource, useUpdateResource } from '../hooks/useMaterials'

/**
 * 新建 / 编辑资源卡 Dialog —— Input(title) + Textarea(desc) + Select(tag)。
 *
 * - `resource` 为 null/undefined = 新建；否则编辑该资源（预填）。
 * - 提交走 hook 层 mutation（toast 在 hook 内，不在本渲染期调用，MEMORY 警示）。
 * - 标题必填（前端拦空，后端再校验 422）。
 * - tag Select 的「无」用哨兵值 TAG_NONE（Radix Select value 不接受空串）。
 */

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入则为编辑模式，否则新建。 */
  resource?: MaterialResource | null
  /** 新建成功后回调（如跳转详情）。 */
  onCreated?: (resource: MaterialResource) => void
}

export function ResourceFormDialog({ open, onOpenChange, resource, onCreated }: Props) {
  const isEdit = !!resource
  const create = useCreateResource()
  const update = useUpdateResource()

  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [tag, setTag] = React.useState<string>(TAG_NONE)

  // 打开时按模式重置表单（编辑预填 / 新建清空）。
  React.useEffect(() => {
    if (!open) return
    setTitle(resource?.title ?? '')
    setDescription(resource?.description ?? '')
    setTag(resource?.tag ?? TAG_NONE)
  }, [open, resource])

  const pending = create.isPending || update.isPending
  const trimmed = title.trim()
  const canSubmit = trimmed.length > 0 && !pending

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const nextTag: ResourceTag | null = tag === TAG_NONE ? null : (tag as ResourceTag)

    if (isEdit && resource) {
      update.mutate(
        {
          rid: resource.id,
          body: { title: trimmed, description: description.trim(), tag: nextTag },
        },
        { onSuccess: () => onOpenChange(false) },
      )
    } else {
      create.mutate(
        { title: trimmed, description: description.trim(), tag: nextTag },
        {
          onSuccess: (created) => {
            onOpenChange(false)
            onCreated?.(created)
          },
        },
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle className="font-serif text-text">
              {isEdit ? '编辑资料' : '新建资料'}
            </DialogTitle>
            <DialogDescription className="text-text-muted">
              {isEdit ? '修改这份资料的标题、简介与角标。' : '创建一份课程资料卡，随后可上传文件。'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="material-title">
                标题 <span className="text-cat-research">*</span>
              </Label>
              <Input
                id="material-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：数字逻辑课程资料"
                maxLength={120}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-desc">简介</Label>
              <Textarea
                id="material-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话说明这份资料包含什么内容（可选）。"
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-tag">角标</Label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger id="material-tag">
                  <SelectValue placeholder="无角标" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TAG_NONE}>无角标</SelectItem>
                  {TAG_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
