"use client";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { SiteHeader } from "@/components/header/site-header";
import { ConsumoPanel } from "@/components/consumo/consumo-panel";
import { NuevoAnalisisPanel } from "@/components/nuevo-analisis/nuevo-analisis-panel";

export function AppShell({ nombreUsuario }: { nombreUsuario: string }) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader nombreUsuario={nombreUsuario} />
      <main className="flex-1">
        <div className="container max-w-6xl mx-auto px-4 py-6">
          <Tabs defaultValue="nuevo" className="w-full">
            <TabsList>
              <TabsTrigger value="nuevo">Nuevo análisis</TabsTrigger>
              <TabsTrigger value="consumo">Mi consumo</TabsTrigger>
            </TabsList>
            <TabsContent value="nuevo" className="mt-6">
              <NuevoAnalisisPanel />
            </TabsContent>
            <TabsContent value="consumo" className="mt-6">
              <ConsumoPanel />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
