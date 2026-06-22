FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY Directory.Packages.props ./
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/vision-service/ services/vision-service/
RUN dotnet restore services/vision-service/src/ND.VisionService.Api/ND.VisionService.Api.csproj
RUN dotnet publish services/vision-service/src/ND.VisionService.Api/ND.VisionService.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
USER app
COPY --chown=app:app --from=build /app/publish .
VOLUME ["/data", "/logs", "/storage"]
EXPOSE 5005
ENV ASPNETCORE_URLS=http://+:5005
ENTRYPOINT ["dotnet", "ND.VisionService.Api.dll"]
