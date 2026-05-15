import { useEffect, useMemo, useState } from 'react'

export const usePagination = <T,>(items: T[], pageSize = 10) => {
  const [page, setPage] = useState(1)
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  useEffect(() => {
    setPage(1)
  }, [items, pageSize])

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  return {
    page,
    pageItems,
    pageSize,
    setPage,
    totalItems,
    totalPages,
  }
}
