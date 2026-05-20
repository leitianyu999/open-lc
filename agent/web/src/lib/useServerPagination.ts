import { useEffect, useMemo } from 'react'

export type ServerPage<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export const useServerPagination = <T>(
  data: ServerPage<T> | undefined,
  options: {
    page: number
    pageSize?: number
    setPage: (page: number) => void
  },
) => {
  const { page: requestedPage, pageSize: requestedPageSize = 20, setPage } = options
  const pageSize = data?.pageSize ?? requestedPageSize
  const totalItems = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const page = Math.min(data?.page ?? requestedPage, totalPages)

  useEffect(() => {
    if (requestedPage > totalPages) setPage(totalPages)
  }, [requestedPage, setPage, totalPages])

  return useMemo(
    () => ({
      page,
      pageItems: data?.items ?? [],
      pageSize,
      setPage,
      totalItems,
      totalPages,
    }),
    [data?.items, page, pageSize, setPage, totalItems, totalPages],
  )
}
