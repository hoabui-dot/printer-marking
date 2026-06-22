FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY Directory.Packages.props ./
COPY station-agent.sln ./
COPY shared/ shared/
COPY services/projection-service/ services/projection-service/
RUN dotnet restore services/projection-service/src/ND.ProjectionService.Api/ND.ProjectionService.Api.csproj
RUN dotnet publish services/projection-service/src/ND.ProjectionService.Api/ND.ProjectionService.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
USER app
COPY --chown=app:app --from=build /app/publish .
VOLUME ["/data", "/logs"]
EXPOSE 5009
ENV DOTNET_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:5009
ENTRYPOINT ["dotnet", "ND.ProjectionService.Api.dll"]
