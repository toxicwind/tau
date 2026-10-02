{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.tau;
in
{
  options.programs.tau = {
    enable = lib.mkEnableOption "TAU coding agent";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "inputs.tau.packages.${pkgs.stdenv.hostPlatform.system}.default";
      description = "TAU package to install system-wide.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];
  };
}
