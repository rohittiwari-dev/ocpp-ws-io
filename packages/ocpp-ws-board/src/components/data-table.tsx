import type * as React from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface DataTableProps<TData> {
  data: TData[];
  columns: {
    header: string | React.ReactNode;
    accessorKey?: keyof TData;
    cell?: (item: TData) => React.ReactNode;
    className?: string;
  }[];
  pageCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

export function DataTable<TData>({
  data,
  columns,
  pageCount,
  currentPage,
  onPageChange,
  isLoading,
}: DataTableProps<TData>) {
  return (
    <div className="space-y-0">
      <div className="glass-card rounded-xl overflow-hidden relative">
        <div className="accent-line-top opacity-40" />
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 bg-muted/20 hover:bg-muted/20">
              {columns.map((col, i) => (
                <TableHead
                  key={i?.toString()}
                  className={`text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ${col.className ?? ""}`}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="size-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    <span className="text-sm">Loading data...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length ? (
              data.map((row, i) => (
                <TableRow
                  key={i?.toString()}
                  className="border-border/30 hover:bg-muted/20 transition-colors duration-150"
                >
                  {columns.map((col, j) => (
                    <TableCell key={j?.toString()} className={col.className}>
                      {col.cell
                        ? col.cell(row)
                        : (row[
                            col.accessorKey as keyof TData
                          ] as React.ReactNode)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="py-3 px-4 border border-border/30 dark:border-white/6 border-t-0 rounded-b-xl bg-muted/20 backdrop-blur-xl">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(currentPage - 1)}
                  className={
                    currentPage === 1 || isLoading
                      ? "pointer-events-none opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                  }
                />
              </PaginationItem>
              <PaginationItem>
                <span className="text-sm font-medium text-muted-foreground px-4">
                  Page{" "}
                  <span className="text-foreground font-semibold">
                    {currentPage}
                  </span>{" "}
                  of {pageCount}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(currentPage + 1)}
                  className={
                    currentPage === pageCount || isLoading
                      ? "pointer-events-none opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
